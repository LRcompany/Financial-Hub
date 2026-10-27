import { Router } from "express";
import { prisma } from "../prisma.js";
import { runDataHealth, type HealthRef } from "../services/integrity.js";
import { brCalendarDay } from "../services/dates.js";
import { purchaseBase } from "../services/ledger.js";
import { reinforceRule } from "../services/categorization.js";
import { ensureReceiptTransaction } from "./projects.js";

// GET /api/data-health (27/10) — regras de integridade dos dados agora (ver
// services/integrity.ts). Alimenta o aviso do Dashboard e a seção "Saúde dos
// dados" em Configurações. Os POST abaixo são os botões de cada aviso ("mas e
// aí, o que eu faço com isso?"): corrigir sozinho, categorizar, ou marcar
// "é assim mesmo".
export const dataHealthRouter = Router();

dataHealthRouter.get("/data-health", async (_req, res) => {
  res.json(await runDataHealth());
});

// POST /api/data-health/fix/:issueId — "Corrigir agora". Só as regras com
// action "auto-fix", e só nos itens que o check acabou de apontar (nunca um id
// vindo do navegador).
const fixers: Record<string, (ref: HealthRef) => Promise<unknown>> = {
  "parcela-duplicada": (ref) => prisma.upcomingInstallment.deleteMany({ where: { id: ref.id } }),
  "parcela-manual-repete-pluggy": (ref) => prisma.upcomingInstallment.deleteMany({ where: { id: ref.id, externalId: null } }),
  "despesa-negativa": (ref) => prisma.transaction.update({ where: { id: ref.id }, data: { isTransfer: true } }),
  "posicao-zerada-com-investido": (ref) => prisma.positionSnapshot.update({ where: { id: ref.id }, data: { investedAmount: 0 } }),
  "recebimento-sem-entrada": (ref) => ensureReceiptTransaction(ref.id),
  "data-fora-do-padrao": async (ref) => {
    if (ref.kind === "transaction") {
      const t = await prisma.transaction.findUnique({ where: { id: ref.id }, select: { date: true } });
      if (t) await prisma.transaction.update({ where: { id: ref.id }, data: { date: brCalendarDay(t.date) } });
    } else {
      const u = await prisma.upcomingInstallment.findUnique({ where: { id: ref.id }, select: { dueDate: true } });
      if (u) await prisma.upcomingInstallment.update({ where: { id: ref.id }, data: { dueDate: brCalendarDay(u.dueDate) } });
    }
  },
};

dataHealthRouter.post("/data-health/fix/:issueId", async (req, res) => {
  const fixer = fixers[req.params.issueId];
  if (!fixer) return res.status(400).json({ error: "Esse aviso não tem conserto automático" });
  // O check devolve no máximo 20 itens por vez — repete até zerar (ou parar
  // de andar, pra nunca ficar em loop).
  let fixed = 0;
  let health = await runDataHealth();
  for (let round = 0; round < 50; round++) {
    const issue = health.issues.find((i) => i.id === req.params.issueId);
    const refs = (issue?.items ?? []).flatMap((it) => (it.ref ? [it.ref] : []));
    if (refs.length === 0) break;
    for (const ref of refs) await fixer(ref);
    fixed += refs.length;
    const before = issue!.total;
    health = await runDataHealth();
    if ((health.issues.find((i) => i.id === req.params.issueId)?.total ?? 0) >= before) break;
  }
  res.json({ fixed, health });
});

// POST /api/data-health/ignore { key } — "É assim mesmo": o item some do
// painel pra sempre (ex: dois cafés iguais no mesmo dia).
dataHealthRouter.post("/data-health/ignore", async (req, res) => {
  const { key } = req.body ?? {};
  if (typeof key !== "string" || !key) return res.status(400).json({ error: "key é obrigatório" });
  await prisma.dataHealthIgnore.upsert({ where: { key }, create: { key }, update: {} });
  res.json({ health: await runDataHealth() });
});

// POST /api/data-health/categorize { refs, categoryId } — "Categorizar".
// Aplica na COMPRA inteira: se é parcelada, todas as parcelas já lançadas e as
// que ainda vêm (mesmo cartão + compra + valor da parcela), pra não sobrar
// parcela "sem categoria" no mês que vem. E reforça a regra do comerciante.
dataHealthRouter.post("/data-health/categorize", async (req, res) => {
  const { refs, categoryId } = req.body ?? {};
  if (!Array.isArray(refs) || refs.length === 0 || !categoryId) return res.status(400).json({ error: "refs e categoryId são obrigatórios" });
  const category = await prisma.category.findUnique({ where: { id: categoryId }, include: { children: true } });
  if (!category || category.type !== "expense") return res.status(404).json({ error: "Categoria de despesa não encontrada" });
  if (category.children.length > 0) return res.status(400).json({ error: "Escolha uma subcategoria (folha), não a categoria-mãe" });

  const txIds = new Set<string>();
  const instIds = new Set<string>();
  const purchases: { card: string | null; base: string; amount: number }[] = [];
  for (const ref of refs as HealthRef[]) {
    if (ref?.kind === "transaction") {
      const t = await prisma.transaction.findUnique({ where: { id: ref.id }, include: { broker: { select: { name: true } } } });
      if (!t) continue;
      txIds.add(t.id);
      if ((t.totalInstallments ?? 0) > 1 || t.installmentNumber) purchases.push({ card: t.broker?.name ?? null, base: purchaseBase(t.description), amount: t.amount });
      await reinforceRule(t.description, categoryId);
    } else if (ref?.kind === "installment") {
      const u = await prisma.upcomingInstallment.findUnique({ where: { id: ref.id } });
      if (!u) continue;
      instIds.add(u.id);
      purchases.push({ card: u.cardLabel, base: purchaseBase(u.description), amount: u.amount });
      await reinforceRule(u.description, categoryId);
    }
  }
  if (purchases.length) {
    const [txs, upcoming] = await Promise.all([
      prisma.transaction.findMany({ where: { type: "expense", OR: [{ installmentNumber: { not: null } }, { totalInstallments: { gt: 1 } }] }, include: { broker: { select: { name: true } } } }),
      prisma.upcomingInstallment.findMany(),
    ]);
    const same = (card: string | null, desc: string, amount: number) =>
      purchases.some((p) => p.card === card && p.base === purchaseBase(desc) && Math.abs(p.amount - amount) < 0.01);
    for (const t of txs) if (same(t.broker?.name ?? null, t.description, t.amount)) txIds.add(t.id);
    for (const u of upcoming) if (same(u.cardLabel, u.description, u.amount)) instIds.add(u.id);
  }
  // Transação dividida mantém as fatias como estão — a categoria é de cada fatia.
  const [a, b] = await Promise.all([
    prisma.transaction.updateMany({ where: { id: { in: [...txIds] }, splits: { none: {} } }, data: { categoryId } }),
    prisma.upcomingInstallment.updateMany({ where: { id: { in: [...instIds] } }, data: { categoryId } }),
  ]);
  res.json({ updated: a.count + b.count, health: await runDataHealth() });
});
