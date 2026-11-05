import { Router } from "express";
import { prisma } from "../prisma.js";
import { runDataHealth, recordMonthTotal, type HealthRef } from "../services/integrity.js";
import { propagateFromRows, purchaseFields, setPurchaseFields } from "../services/purchases.js";
import { brCalendarDay } from "../services/dates.js";
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
  // Parcela com categoria/nota diferente da compra dela → a da compra em todas.
  "parcela-diferente-da-compra": async (ref) => {
    const row =
      ref.kind === "transaction"
        ? await prisma.transaction.findUnique({ where: { id: ref.id }, select: { purchaseId: true } })
        : await prisma.upcomingInstallment.findUnique({ where: { id: ref.id }, select: { purchaseId: true } });
    if (!row?.purchaseId) return;
    const f = await purchaseFields(row.purchaseId);
    await setPurchaseFields([row.purchaseId], { categoryId: f.categoryId ?? undefined, note: f.note ?? undefined });
  },
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
  // "Mês fechado mudou" → "É assim mesmo" = o valor de agora passa a ser o
  // valor fechado daquele mês (se mudar de novo, avisa de novo).
  const closed = key.match(/^mes-fechado-mudou:(\d{4}-\d{2})$/);
  if (closed) await recordMonthTotal(closed[1]);
  else await prisma.dataHealthIgnore.upsert({ where: { key }, create: { key }, update: {} });
  res.json({ health: await runDataHealth() });
});

// POST /api/data-health/categorize { refs, categoryId } — "Categorizar".
// Parcela de compra parcelada: a categoria é da COMPRA (services/purchases.ts)
// — vale pra todas as parcelas já lançadas e as que ainda vêm, pra não sobrar
// parcela "sem categoria" no mês que vem. E reforça a regra do comerciante.
dataHealthRouter.post("/data-health/categorize", async (req, res) => {
  const { refs, categoryId } = req.body ?? {};
  if (!Array.isArray(refs) || refs.length === 0 || !categoryId) return res.status(400).json({ error: "refs e categoryId são obrigatórios" });
  const category = await prisma.category.findUnique({ where: { id: categoryId }, include: { children: true } });
  if (!category || category.type !== "expense") return res.status(404).json({ error: "Categoria de despesa não encontrada" });
  if (category.children.length > 0) return res.status(400).json({ error: "Escolha uma subcategoria (folha), não a categoria-mãe" });

  const txIds: string[] = [];
  const instIds: string[] = [];
  for (const ref of refs as HealthRef[]) {
    if (ref?.kind === "transaction") {
      const t = await prisma.transaction.findUnique({ where: { id: ref.id }, select: { id: true, description: true } });
      if (!t) continue;
      txIds.push(t.id);
      await reinforceRule(t.description, categoryId);
    } else if (ref?.kind === "installment") {
      const u = await prisma.upcomingInstallment.findUnique({ where: { id: ref.id }, select: { id: true, description: true } });
      if (!u) continue;
      instIds.push(u.id);
      await reinforceRule(u.description, categoryId);
    }
  }
  // Transação dividida mantém as fatias como estão — a categoria é de cada fatia.
  const [a, b] = await Promise.all([
    prisma.transaction.updateMany({ where: { id: { in: txIds }, splits: { none: {} } }, data: { categoryId } }),
    prisma.upcomingInstallment.updateMany({ where: { id: { in: instIds } }, data: { categoryId } }),
  ]);
  await propagateFromRows({ transactionIds: txIds, installmentIds: instIds }, { categoryId });
  res.json({ updated: a.count + b.count, health: await runDataHealth() });
});
