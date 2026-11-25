// Ferramentas de detalhe do conector MCP (25/11) — fase 1 da ampliação, só
// leitura. Luiz: "Ampliar o conector MCP do Command OS para TODAS as áreas...
// Todo número mostra a ORIGEM e a data da última alteração."
//
// Origem = de onde o número veio (Pluggy, digitado no app, livro de custo,
// cotação PTAX...). Data = `alterado_em` (coluna `updatedAt`, só existe a
// partir de 25/11 — linha antiga vem null e isso é dito na resposta, nunca
// inventado) ou a data da sincronização que gravou o número.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma } from "../prisma.js";
import { fetchAllSnapshots, activeSnapshotsAsOf, yearMonth } from "../services/activePositions.js";
import { ledgerCostAt, monthEnd } from "../services/costLedger.js";
import { closingPair } from "../services/foreignFx.js";
import { getRateToBrl, isForeignCurrency } from "../services/fx.js";
import { getAccounts, getInvestments, getItem, getTransactions } from "../services/pluggy.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;
type Reply = (fn: (args: Json) => Promise<unknown>) => (args: Json) => Promise<Json>;

const r2 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 100) / 100);
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const stamp = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 16).replace("T", " ") + " UTC" : null);
const SEM_DATA = "sem registro (alteração anterior a 25/11/2026 não era guardada)";
const alteradoEm = (d: Date | null | undefined) => stamp(d) ?? SEM_DATA;
const catPath = (c: { name: string; parent?: { name: string } | null } | null | undefined) => (c ? (c.parent ? `${c.parent.name} > ${c.name}` : c.name) : "Sem categoria");
const mm = (month: number, year: number) => `${String(month).padStart(2, "0")}/${year}`;

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const mesArg = z.number().int().min(1).max(12).optional().describe("Mês 1–12 (padrão: mês atual)");
const anoArg = z.number().int().min(2018).max(2100).optional().describe("Ano (padrão: ano atual)");

function period(a: { mes?: number; ano?: number }) {
  const now = new Date();
  const month = a.mes ?? now.getMonth() + 1;
  const year = a.ano ?? now.getFullYear();
  return { month, year, start: new Date(year, month - 1, 1), end: new Date(year, month, 1), ym: yearMonth(year, month) };
}

const TX_ORIGEM: Record<string, string> = { pluggy: "Pluggy (banco/cartão)", manual: "digitado no app" };

/** Tira do bruto da Pluggy o que identifica a pessoa (CPF/CNPJ, documento, titular) e segredos (webhook, credenciais); número de conta/cartão só com o final. */
export function redactPluggy(v: Json): Json {
  if (Array.isArray(v)) return v.map(redactPluggy);
  if (v && typeof v === "object") {
    const out: Json = {};
    for (const [k, val] of Object.entries(v)) {
      if (/taxNumber|document|cpf|cnpj|owner|webhookUrl|credentials|oauth|clientUserId/i.test(k)) out[k] = val == null ? val : "[oculto]";
      else if (/^(number|transferNumber|cardNumber|accountNumber)$/.test(k) && typeof val === "string" && val.length > 4) out[k] = `…${val.slice(-4)}`;
      else out[k] = redactPluggy(val);
    }
    return out;
  }
  return v;
}

const exec = promisify(execFile);

export function registerDetailTools(server: McpServer, reply: Reply, api: (path: string) => Promise<Json>) {
  // ---------- Orçamento ----------
  server.registerTool(
    "lancamentos_detalhe",
    {
      title: "Lançamentos do mês, com origem",
      description:
        "Cada lançamento real do mês (despesa, entrada, transferência): data, descrição, valor, categoria, divisão entre categorias, cartão/conta, parcela N/total, nota, " +
        "se ainda está pendente no banco, ORIGEM (Pluggy ou digitado) e datas de criação e última alteração. Filtros por texto e categoria. " +
        "Use pra conferir um lançamento específico ou entender por que um total deu o que deu (o total do Orçamento é a ferramenta `gastos`).",
      inputSchema: {
        mes: mesArg,
        ano: anoArg,
        busca: z.string().optional().describe("Parte da descrição ou nota (ex: MASTERCARD, Uber)"),
        categoria: z.string().optional().describe("Parte do nome da categoria"),
        tipo: z.enum(["despesa", "entrada", "todos"]).optional().describe("Padrão: todos"),
        limite: z.number().int().min(1).max(500).optional().describe("Máximo de lançamentos (padrão 150, mais recentes primeiro)"),
      },
      annotations: readOnly,
    },
    reply(async (a) => {
      const p = period(a);
      const type = a.tipo === "despesa" ? "expense" : a.tipo === "entrada" ? "income" : undefined;
      const txs = await prisma.transaction.findMany({
        where: { date: { gte: p.start, lt: p.end }, ...(type ? { type } : {}) },
        include: { category: { include: { parent: true } }, splits: { include: { category: { include: { parent: true } } } }, broker: { select: { name: true } } },
        orderBy: { date: "desc" },
      });
      const busca = a.busca?.toLowerCase();
      const cat = a.categoria?.toLowerCase();
      const rows = txs
        .filter((t) => !busca || t.description.toLowerCase().includes(busca) || (t.note ?? "").toLowerCase().includes(busca))
        .filter((t) => !cat || catPath(t.category).toLowerCase().includes(cat) || t.splits.some((s) => catPath(s.category).toLowerCase().includes(cat)));
      return {
        periodo: mm(p.month, p.year),
        quantidade: rows.length,
        total_despesas: r2(rows.filter((t) => t.type === "expense" && !t.isTransfer).reduce((s, t) => s + t.amount, 0)),
        total_entradas: r2(rows.filter((t) => t.type === "income" && !t.isTransfer).reduce((s, t) => s + t.amount, 0)),
        lancamentos: rows.slice(0, a.limite ?? 150).map((t) => ({
          id: t.id,
          data: day(t.date),
          descricao: t.description,
          valor: r2(t.amount),
          tipo: t.isTransfer ? "transferência" : t.type === "income" ? "entrada" : "despesa",
          categoria: t.splits.length ? "dividido" : catPath(t.category),
          divisao: t.splits.length ? t.splits.map((s) => ({ categoria: catPath(s.category), valor: r2(s.amount) })) : null,
          conta_ou_cartao: t.broker?.name ?? null,
          parcela: t.installmentNumber && t.totalInstallments ? `${t.installmentNumber}/${t.totalInstallments}` : null,
          nota: t.note,
          pendente_no_banco: t.pluggyPending,
          origem: TX_ORIGEM[t.source] ?? t.source,
          criado_em: stamp(t.createdAt),
          alterado_em: alteradoEm(t.updatedAt),
        })),
      };
    })
  );

  // ---------- Parcelas ----------
  server.registerTool(
    "parcelas_detalhe",
    {
      title: "Compras parceladas, uma a uma",
      description:
        "Cada compra parcelada: descrição, cartão, categoria, valor da parcela, parcelas já lançadas e as que faltam (com data e valor), total que ainda falta pagar, " +
        "quando termina, ORIGEM (Pluggy ou digitada) e data da última alteração. Por padrão só as que ainda têm parcela pela frente.",
      inputSchema: {
        cartao: z.string().optional().describe("Parte do nome do cartão"),
        incluir_quitadas: z.boolean().optional().describe("Incluir compras que já terminaram (padrão: não)"),
      },
      annotations: readOnly,
    },
    reply(async (a) => {
      const today = new Date();
      const purchases = await prisma.purchase.findMany({
        include: {
          category: { include: { parent: true } },
          transactions: { select: { date: true, amount: true, installmentNumber: true, source: true }, orderBy: { date: "asc" } },
          installments: { select: { dueDate: true, amount: true, updatedAt: true, createdAt: true }, orderBy: { dueDate: "asc" } },
        },
      });
      const card = a.cartao?.toLowerCase();
      const rows = purchases
        .filter((pu) => !card || (pu.cardLabel ?? "").toLowerCase().includes(card))
        .map((pu) => {
          const future = pu.installments.filter((i) => i.dueDate >= today);
          const source = pu.transactions.some((t) => t.source === "pluggy") ? "Pluggy (cartão)" : "digitada no app";
          const lastChange = [pu.updatedAt, ...pu.installments.map((i) => i.updatedAt ?? null)].filter(Boolean).sort((x, y) => y!.getTime() - x!.getTime())[0];
          return {
            descricao: pu.note ?? pu.description,
            cartao: pu.cardLabel,
            categoria: catPath(pu.category),
            valor_parcela: r2(pu.installmentAmount),
            total_parcelas: pu.totalInstallments,
            lancadas: pu.transactions.length,
            ultima_lancada: pu.transactions.length ? { data: day(pu.transactions.at(-1)!.date), parcela: pu.transactions.at(-1)!.installmentNumber } : null,
            faltam: future.length,
            falta_pagar: r2(future.reduce((s, i) => s + i.amount, 0)),
            proximas: future.slice(0, 6).map((i) => ({ data: day(i.dueDate), valor: r2(i.amount) })),
            termina_em: day(future.at(-1)?.dueDate ?? pu.installments.at(-1)?.dueDate ?? null),
            origem: source,
            criada_em: stamp(pu.createdAt),
            alterada_em: alteradoEm(lastChange),
          };
        })
        .filter((r) => a.incluir_quitadas || r.faltam > 0)
        .sort((x, y) => (y.falta_pagar ?? 0) - (x.falta_pagar ?? 0));
      return {
        compras: rows.length,
        falta_pagar_total: r2(rows.reduce((s, r) => s + (r.falta_pagar ?? 0), 0)),
        por_cartao: [...rows.reduce((m, r) => m.set(r.cartao ?? "?", (m.get(r.cartao ?? "?") ?? 0) + (r.falta_pagar ?? 0)), new Map<string, number>())].map(([cartao, v]) => ({ cartao, falta_pagar: r2(v) })),
        parceladas: rows,
      };
    })
  );

  // ---------- Patrimônio ----------
  server.registerTool(
    "posicoes_detalhe",
    {
      title: "Posições do mês, com origem de cada número",
      description:
        "Cada posição do mês: quantidade, preço, valor de mercado, investido, cotação de câmbio (e de onde veio: PTAX de fechamento, dólar do dia...), " +
        "ORIGEM do valor de mercado (sync da Pluggy com data, digitado no app, consulta on-chain, foto de mês anterior carregada) e ORIGEM do investido " +
        "(livro de custo: preço médio do BTG + movimentações, com data da base; valor aplicado da corretora; digitado; aportes registrados). Filtro por corretora.",
      inputSchema: { mes: mesArg, ano: anoArg, corretora: z.string().optional().describe("Parte do nome da corretora (ex: BTG, NOMAD)") },
      annotations: readOnly,
    },
    reply(async (a) => {
      const p = period(a);
      const all = await fetchAllSnapshots();
      const broker = a.corretora?.toLowerCase();
      const snaps = activeSnapshotsAsOf(all, p.ym).filter((s) => !broker || s.broker.name.toLowerCase().includes(broker));
      const closings = new Map((await prisma.fxRateCache.findMany({ where: { pair: { contains: "@" } } })).map((c) => [c.pair, c]));
      const rows = [];
      for (const s of snaps.sort((x, y) => y.marketValue - x.marketValue)) {
        const snapYm = yearMonth(s.year, s.month);
        const marketOrigin =
          s.broker.dataSource === "pluggy"
            ? s.carriedForward
              ? "Pluggy não mandou a posição nesse sync — repetida da última vez que mandou"
              : `Pluggy (sync de ${stamp(s.syncedAt) ?? "data não registrada (antes de 17/11)"})`
            : s.broker.dataSource === "onchain_query"
              ? `consulta on-chain (${stamp(s.syncedAt) ?? "data não registrada"})`
              : "digitado no app (Atualizar posições)";
        let investedOrigin: Json;
        if (s.security.type === "Conta Corrente") investedOrigin = "saldo (conta corrente não tem custo separado)";
        else if (s.security.type === "Ação" || s.security.type === "FII") {
          const cost = await ledgerCostAt(s.securityId, monthEnd(p.year, p.month));
          investedOrigin = cost
            ? {
                fonte: { preco_medio_btg: "livro de custo — preço médio do BTG", movimentacao: "livro de custo — base + compras/vendas do extrato", ajuste: "livro de custo — com ajuste" }[cost.origin],
                base_desde: day(cost.baseDate),
                ultima_mudanca_no_custo: day(cost.changedAt),
                eventos_sem_quantidade_pendentes: cost.unresolved.length,
              }
            : "sem base no livro de custo — investido herdado da planilha/primeira foto";
        } else if (s.broker.dataSource === "pluggy") investedOrigin = "Pluggy (valor aplicado informado pela corretora)";
        else investedOrigin = "digitado no app / aportes registrados";
        let fx: Json = null;
        if (s.fxRateToBRL && isForeignCurrency(s.security.currency)) {
          const closing = closings.get(closingPair(s.security.currency, s.year, s.month));
          fx = {
            moeda: s.security.currency,
            cotacao: s.fxRateToBRL,
            fonte:
              closing && Math.abs(closing.rate - s.fxRateToBRL) < 1e-6
                ? `${closing.source === "ptax_venda" ? "PTAX de venda" : closing.source ?? "fechamento"} de ${day(closing.fetchedAt)}`
                : snapYm === yearMonth(new Date().getFullYear(), new Date().getMonth() + 1)
                  ? "dólar do dia (mês corrente)"
                  : "cotação do dia em que foi gravada (sem fechamento ainda)",
            valor_na_moeda: r2(s.marketValue / s.fxRateToBRL),
            investido_na_moeda: r2(s.investedOriginal ?? s.investedAmount / s.fxRateToBRL),
          };
        }
        rows.push({
          corretora: s.broker.name,
          ativo: s.security.ticker ? `${s.security.ticker} · ${s.security.name}` : s.security.name,
          tipo: s.security.type,
          foto_de: mm(s.month, s.year) + (snapYm !== p.ym ? " (carregada: a corretora não tem foto desse mês)" : ""),
          quantidade: s.quantity,
          preco_unitario: r2(s.unitValue),
          valor_mercado: r2(s.marketValue),
          investido: r2(s.investedAmount),
          ganho: r2(s.marketValue - s.investedAmount),
          cambio: fx,
          origem_valor_mercado: marketOrigin,
          origem_investido: investedOrigin,
          alterado_em: alteradoEm(s.updatedAt ?? s.syncedAt),
        });
      }
      return { periodo: mm(p.month, p.year), posicoes: rows.length, total_mercado: r2(rows.reduce((t, r) => t + (r.valor_mercado ?? 0), 0)), itens: rows };
    })
  );

  server.registerTool(
    "ajustes_do_mes",
    {
      title: "O que mexeu no investido no mês",
      description:
        "Por posição: investido no fim do mês anterior → fim do mês, diferença, aplicações/resgates do extrato no mês, lançamentos no livro de custo, e se a " +
        "diferença está EXPLICADA (por movimentação ou livro de custo) ou é AJUSTE SEM TRANSAÇÃO (a corretora mudou o número sozinha). Também a variação do valor de mercado. " +
        "Use quando o aporte de um mês parecer estranho.",
      inputSchema: { mes: mesArg, ano: anoArg },
      annotations: readOnly,
    },
    reply(async (a) => {
      const p = period(a);
      const all = await fetchAllSnapshots();
      // Agrupa por corretora + código: a Pluggy às vezes troca o id do ativo
      // (ex: Tesouro Selic 2029 do BTG em out/26) — sem isso aparece "posição
      // nova" + "ajuste sem transação" falsos pro mesmo título.
      type Snap = ReturnType<typeof activeSnapshotsAsOf>[number];
      const groupKey = (s: Snap) => `${s.brokerId}|${s.security.ticker ?? s.security.name}`;
      const live = (s: Snap) => s.marketValue > 0.005 || s.investedAmount > 0.005;
      const group = (list: Snap[]) => {
        const m = new Map<string, Snap[]>();
        for (const s of list) if (s.security.type !== "Conta Corrente") m.set(groupKey(s), [...(m.get(groupKey(s)) ?? []), s]);
        return m;
      };
      const cur = group(activeSnapshotsAsOf(all, p.ym));
      const prev = group(activeSnapshotsAsOf(all, p.ym - 1));
      const [movements, entries] = await Promise.all([
        prisma.investmentMovement.findMany({ where: { date: { gte: p.start, lt: p.end } } }),
        prisma.costEntry.findMany({ where: { date: { gte: p.start, lt: p.end } } }),
      ]);
      const sum = (list: Snap[] | undefined, f: (s: Snap) => number) => (list ?? []).reduce((t, s) => t + f(s), 0);
      const rows = [];
      for (const key of new Set([...cur.keys(), ...prev.keys()])) {
        const c = cur.get(key);
        const b = prev.get(key);
        const s = (c ?? b)![0];
        const ids = new Set([...(c ?? []), ...(b ?? [])].map((x) => x.securityId));
        const hadBefore = (b ?? []).some(live);
        const hasNow = (c ?? []).some(live);
        const before = sum(b, (x) => x.investedAmount);
        const after = sum(c, (x) => x.investedAmount);
        const delta = after - before;
        const mv = movements.filter((m) => ids.has(m.securityId));
        const net = mv.reduce((t, m) => t + (m.kind === "resgate" ? -m.amount : m.amount), 0);
        const ce = entries.filter((e) => ids.has(e.securityId));
        const marketDelta = sum(c, (x) => x.marketValue) - sum(b, (x) => x.marketValue);
        if (Math.abs(delta) < 1 && !ce.length && hadBefore === hasNow && Math.abs(net) < 1) continue; // centavos
        // Ação/FII com base no livro de custo: o investido é o do livro (eventos
        // sem dinheiro, como os direitos da AXIA, não mexem no custo).
        let ledgerDelta: number | null = null;
        if ((s.security.type === "Ação" || s.security.type === "FII") && hadBefore && hasNow) {
          let costBefore = 0;
          let costAfter = 0;
          let all = true;
          for (const id of ids) {
            const [cb, ca] = await Promise.all([ledgerCostAt(id, monthEnd(p.month === 1 ? p.year - 1 : p.year, p.month === 1 ? 12 : p.month - 1)), ledgerCostAt(id, monthEnd(p.year, p.month))]);
            if (!ca) all = false;
            costBefore += cb?.invested ?? 0;
            costAfter += ca?.invested ?? 0;
          }
          if (all) ledgerDelta = costAfter - costBefore;
        }
        const explained = ledgerDelta ?? net;
        const explicacao = !hadBefore
          ? "posição nova no mês (entra como saldo inicial ou aporte)"
          : !hasNow
            ? "posição saiu no mês"
            : ledgerDelta != null
              ? Math.abs(delta - ledgerDelta) < 1
                ? "explicada pelo livro de custo (preço médio do BTG + compras/vendas; evento sem dinheiro não mexe no custo)"
                : "DIFERENTE DO LIVRO DE CUSTO — a foto não bate com o livro"
              : ce.length
              ? "livro de custo (base/ajuste lançado no mês)"
              : Math.abs(delta - net) < 1
                ? "explicada pelas movimentações do extrato"
                : mv.length
                  ? "parte explicada pelas movimentações — o resto é ajuste da corretora"
                  : "AJUSTE SEM TRANSAÇÃO — o investido mudou sem aplicação/resgate";
        rows.push({
          corretora: s.broker.name,
          ativo: s.security.ticker ?? s.security.name,
          tipo: s.security.type,
          ...(ids.size > 1 ? { aviso: `a corretora trocou o código interno desse ativo (${ids.size} registros somados)` } : {}),
          investido_antes: r2(before),
          investido_depois: r2(after),
          diferenca: r2(delta),
          movimentacoes_liquidas: r2(net),
          ...(ledgerDelta != null ? { mudanca_no_livro_de_custo: r2(ledgerDelta) } : {}),
          nao_explicado: !hadBefore || !hasNow ? null : r2(ledgerDelta != null || !ce.length ? delta - explained : 0),
          ...(isForeignCurrency(s.security.currency)
            ? {
                moeda: s.security.currency,
                investido_na_moeda_antes: r2(sum(b, (x) => x.investedOriginal ?? (x.fxRateToBRL ? x.investedAmount / x.fxRateToBRL : 0))),
                investido_na_moeda_depois: r2(sum(c, (x) => x.investedOriginal ?? (x.fxRateToBRL ? x.investedAmount / x.fxRateToBRL : 0))),
              }
            : {}),
          movimentacoes: mv.map((m) => ({ data: day(m.date), tipo: m.kind, valor: r2(m.amount), quantidade: m.quantity, origem: m.source === "pluggy" ? "extrato da Pluggy" : "lançada à mão", registrada_em: stamp(m.createdAt) })),
          livro_de_custo: ce.map((e) => ({ data: day(e.date), tipo: e.kind, valor: r2(e.amount), fonte: e.source, motivo: e.reason, desfeito: e.revertedAt ? stamp(e.revertedAt) : null })),
          variacao_valor_mercado: r2(marketDelta),
          explicacao,
        });
      }
      rows.sort((x, y) => Math.abs(y.diferenca ?? 0) - Math.abs(x.diferenca ?? 0));
      return {
        periodo: mm(p.month, p.year),
        posicoes_que_mudaram: rows.length,
        ajustes_sem_transacao: rows.filter((r) => /^(AJUSTE|parte|DIFERENTE)/.test(r.explicacao)).length,
        itens: rows,
      };
    })
  );

  server.registerTool(
    "pluggy_bruto",
    {
      title: "Dado bruto da Pluggy (ao vivo)",
      description:
        "Consulta a Pluggy AGORA e devolve os campos crus que ela manda pra uma corretora/banco conectado: `item` (status da conexão), `contas`, `investimentos` " +
        "ou `transacoes` (1ª página por conta, ~500 mais recentes). CPF/CNPJ e documentos vêm ocultos; número de conta só com o final. " +
        "Use pra comparar o que a corretora mandou com o que o Command OS gravou.",
      inputSchema: {
        corretora: z.string().describe("Nome da corretora/banco (ex: BTG, C6, Sofisa, 99)"),
        recurso: z.enum(["item", "contas", "investimentos", "transacoes"]),
        busca: z.string().optional().describe("Filtra por texto (nome, código, descrição)"),
        limite: z.number().int().min(1).max(200).optional().describe("Máximo de registros (padrão 40)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    reply(async (a) => {
      const broker = (await prisma.broker.findMany({ where: { dataSource: "pluggy", pluggyConnectorId: { not: null } } })).find((b) =>
        b.name.toLowerCase().includes(String(a.corretora).toLowerCase())
      );
      if (!broker) return { aviso: `Nenhuma conexão Pluggy com "${a.corretora}".` };
      const itemId = broker.pluggyConnectorId!;
      const limit = a.limite ?? 40;
      const busca = a.busca?.toLowerCase();
      const match = (x: Json) => !busca || JSON.stringify(x).toLowerCase().includes(busca);
      const consultadoEm = stamp(new Date());
      if (a.recurso === "item") return { corretora: broker.name, consultado_em: consultadoEm, item: redactPluggy(await getItem(itemId)) };
      if (a.recurso === "contas") {
        const r: Json = await getAccounts(itemId);
        return { corretora: broker.name, consultado_em: consultadoEm, contas: redactPluggy((r.results ?? []).filter(match).slice(0, limit)) };
      }
      if (a.recurso === "investimentos") {
        const r: Json = await getInvestments(itemId);
        const list = (r.results ?? []).filter(match);
        return { corretora: broker.name, consultado_em: consultadoEm, total: list.length, investimentos: redactPluggy(list.slice(0, limit)) };
      }
      const accounts: Json = await getAccounts(itemId);
      const out = [];
      for (const acc of accounts.results ?? []) {
        const r: Json = await getTransactions(acc.id);
        out.push({ conta: acc.name, tipo: acc.type, mais_paginas: !!r.next, transacoes: (r.results ?? []).filter(match).slice(0, limit) });
      }
      return { corretora: broker.name, consultado_em: consultadoEm, contas: redactPluggy(out) };
    })
  );

  // ---------- Projetos ----------
  server.registerTool(
    "recebimentos",
    {
      title: "Recebimentos de projetos, um a um",
      description:
        "Cada recebimento de projeto no ano (ou no mês): cliente, projeto, parcela, data, moeda original, valor bruto na moeda, tarifa e IOF (na moeda), cotação efetiva, " +
        "valor que chegou em R$, ORIGEM (casado com o lançamento do banco ou só digitado) e data da última alteração. Com total por mês e por cliente.",
      inputSchema: { ano: anoArg, mes: mesArg },
      annotations: readOnly,
    },
    reply(async (a) => {
      const year = a.ano ?? new Date().getFullYear();
      const start = a.mes ? new Date(year, a.mes - 1, 1) : new Date(year, 0, 1);
      const end = a.mes ? new Date(year, a.mes, 1) : new Date(year + 1, 0, 1);
      const receipts = await prisma.projectReceipt.findMany({
        where: { paymentDate: { gte: start, lt: end } },
        include: { project: { include: { client: true } }, transactions: { select: { date: true, amount: true, broker: { select: { name: true } } } } },
        orderBy: { paymentDate: "asc" },
      });
      const rows = receipts.map((r) => {
        const currency = r.project.currency ?? "BRL";
        const foreign = r.grossAmountForeign != null && currency !== "BRL";
        const netForeign = foreign ? r.grossAmountForeign! - (r.feeAmount ?? 0) - (r.iofAmount ?? 0) : null;
        return {
          data: day(r.paymentDate),
          cliente: r.project.client.name,
          projeto: r.project.name,
          parcela: `${r.installmentNumber}/${r.project.installmentCount}`,
          moeda: currency,
          valor_bruto_na_moeda: foreign ? r2(r.grossAmountForeign) : null,
          tarifa_na_moeda: r2(r.feeAmount),
          iof_na_moeda: r2(r.iofAmount),
          cotacao_efetiva: foreign && netForeign ? Math.round((r.amount / netForeign) * 10000) / 10000 : null,
          valor_em_reais: r2(r.amount),
          origem: r.transactions.length
            ? `casado com lançamento do banco (${r.transactions.map((t) => `${t.broker?.name ?? "sem conta"} ${day(t.date)} R$ ${r2(t.amount)}`).join("; ")})`
            : "digitado no app, sem lançamento do banco casado",
          alterado_em: alteradoEm(r.updatedAt),
        };
      });
      const sum = (key: (r: (typeof rows)[number]) => string) =>
        [...rows.reduce((m, r) => m.set(key(r), (m.get(key(r)) ?? 0) + (r.valor_em_reais ?? 0)), new Map<string, number>())].map(([k, v]) => ({ chave: k, total: r2(v) }));
      return {
        periodo: a.mes ? mm(a.mes, year) : String(year),
        total_em_reais: r2(rows.reduce((t, r) => t + (r.valor_em_reais ?? 0), 0)),
        por_mes: sum((r) => r.data!.slice(0, 7)).map((x) => ({ mes: x.chave, total: x.total })),
        por_cliente: sum((r) => r.cliente).map((x) => ({ cliente: x.chave, total: x.total })).sort((x, y) => (y.total ?? 0) - (x.total ?? 0)),
        recebimentos: rows,
      };
    })
  );

  server.registerTool(
    "a_receber",
    {
      title: "A receber por cliente",
      description:
        "Projetos em aberto, por cliente: moeda, contrato, recebido, quanto falta (na moeda e em R$), parcelas recebidas/total e data esperada (fim do contrato — o app não guarda data por parcela). " +
        "Falta em moeda estrangeira também vem estimado em R$ pelo dólar/euro de hoje (estimativa, não valor garantido).",
      inputSchema: {},
      annotations: readOnly,
    },
    reply(async () => {
      const list: Json[] = await api("/projects");
      const open = list.filter((x) => (x.status === "em_andamento" || x.status === "pausado") && (x.remaining > 0.005 || (x.remainingForeign ?? 0) > 0.005));
      const counts = new Map((await prisma.projectReceipt.groupBy({ by: ["projectId"], _count: { _all: true } })).map((g) => [g.projectId, g._count._all]));
      const todayIso = new Date().toISOString().slice(0, 10);
      const rates = new Map<string, number | null>();
      for (const c of new Set(open.map((x) => x.currency).filter((c) => isForeignCurrency(c)))) rates.set(c, await getRateToBrl(c).catch(() => null));
      const rows = open.map((x) => {
        const rate = x.currency ? rates.get(x.currency) ?? null : null;
        return {
          cliente: x.client.name,
          projeto: x.name,
          status: x.status,
          moeda: x.currency ?? "BRL",
          contrato_em_reais: r2(x.contractValue),
          contrato_na_moeda: r2(x.contractValueForeign),
          recebido_em_reais: r2(x.received),
          falta_em_reais: r2(x.remaining),
          falta_na_moeda: r2(x.remainingForeign),
          falta_estimada_em_reais_hoje: x.remainingForeign != null && rate ? r2(x.remainingForeign * rate) : null,
          cotacao_usada_na_estimativa: x.remainingForeign != null ? rate : null,
          parcelas_recebidas: `${counts.get(x.id) ?? 0}/${x.installmentCount}`,
          data_esperada: day(x.endDate ? new Date(x.endDate) : null) ?? "sem data de fim no contrato",
          atrasado: x.endDate ? String(x.endDate).slice(0, 10) < todayIso : false,
        };
      });
      const byClient = [...rows.reduce((m, r) => m.set(r.cliente, (m.get(r.cliente) ?? 0) + (r.falta_estimada_em_reais_hoje ?? r.falta_em_reais ?? 0)), new Map<string, number>())]
        .map(([cliente, v]) => ({ cliente, falta_em_reais: r2(v) }))
        .sort((x, y) => (y.falta_em_reais ?? 0) - (x.falta_em_reais ?? 0));
      return { total_em_reais: r2(byClient.reduce((t, c) => t + (c.falta_em_reais ?? 0), 0)), por_cliente: byClient, projetos: rows };
    })
  );

  // ---------- Geral ----------
  server.registerTool(
    "historico_sync",
    {
      title: "Histórico de sincronização",
      description:
        "Cada sincronização dos últimos N dias (cartão/conta, investimentos, on-chain, câmbio): quando, quem disparou (agendador, botão, webhook), quanto tempo, " +
        "se deu certo e o resumo ou o erro. Também a última sincronização de cada corretora e, nas conectadas à Pluggy, o status da conexão agora. Registro existe desde 25/11/2026.",
      inputSchema: { dias: z.number().int().min(1).max(90).optional().describe("Padrão 7"), status_pluggy: z.boolean().optional().describe("Consultar o status das conexões na Pluggy agora (padrão: sim)") },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    reply(async (a) => {
      const since = new Date(Date.now() - (a.dias ?? 7) * 86400000);
      const [runs, brokers] = await Promise.all([
        prisma.syncRun.findMany({ where: { startedAt: { gte: since } }, orderBy: { startedAt: "desc" }, take: 300 }),
        prisma.broker.findMany({ where: { archivedAt: null, dataSource: { in: ["pluggy", "onchain_query", "manual_statement"] } } }),
      ]);
      const conexoes = [];
      for (const b of brokers) {
        let pluggy: Json = null;
        if (b.dataSource === "pluggy" && b.pluggyConnectorId && a.status_pluggy !== false) {
          try {
            const it: Json = await getItem(b.pluggyConnectorId);
            pluggy = { status: it.status, execucao: it.executionStatus, banco_atualizou_em: it.lastUpdatedAt, proxima_atualizacao: it.nextAutoSyncAt ?? null };
          } catch (err) {
            pluggy = { erro: (err as Error).message };
          }
        }
        conexoes.push({
          corretora: b.name,
          tipo: b.dataSource === "pluggy" ? "Pluggy" : b.dataSource === "onchain_query" ? "on-chain" : "digitada no app",
          ultima_sincronizacao: stamp(b.lastSyncedAt),
          pluggy_agora: pluggy,
        });
      }
      return {
        desde: day(since),
        aviso: "Execuções antes de 25/11/2026 não foram registradas.",
        execucoes: runs.map((r) => ({
          quando: stamp(r.startedAt),
          tipo: r.kind,
          corretora: r.brokerName,
          disparado_por: r.trigger,
          duracao_s: Math.round((r.finishedAt.getTime() - r.startedAt.getTime()) / 100) / 10,
          ok: r.ok,
          resumo: r.summary,
          erro: r.error,
        })),
        conexoes,
      };
    })
  );

  server.registerTool(
    "changelog",
    {
      title: "O que mudou no Command OS",
      description:
        "Mudanças dos últimos N dias: versões do app publicadas (commits no servidor), lançamentos no livro de custo (base, ajuste, desfeito), avisos da saúde dos dados " +
        "marcados como \"É assim mesmo\" e lançamentos alterados depois de criados. Use pra explicar por que um número mudou.",
      inputSchema: { dias: z.number().int().min(1).max(180).optional().describe("Padrão 7") },
      annotations: readOnly,
    },
    reply(async (a) => {
      const days = a.dias ?? 7;
      const since = new Date(Date.now() - days * 86400000);
      let versoes: Json[] = [];
      try {
        const { stdout } = await exec("git", ["log", `--since=${days}.days`, "--date=iso-strict", "--pretty=format:%h%x09%ad%x09%s"], { cwd: process.cwd(), timeout: 5000 });
        versoes = stdout
          .split("\n")
          .filter(Boolean)
          .map((l) => {
            const [hash, date, subject] = l.split("\t");
            return { commit: hash, quando: date, o_que: subject };
          });
      } catch (err) {
        versoes = [{ erro: `não consegui ler o histórico de versões: ${(err as Error).message}` }];
      }
      const [costs, ignored, edited] = await Promise.all([
        prisma.costEntry.findMany({ where: { OR: [{ createdAt: { gte: since } }, { revertedAt: { gte: since } }] }, include: { security: { select: { ticker: true, name: true } } }, orderBy: { createdAt: "desc" } }),
        prisma.dataHealthIgnore.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "desc" } }),
        prisma.transaction.findMany({ where: { updatedAt: { gte: since } }, select: { date: true, description: true, amount: true, createdAt: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 200 }),
      ]);
      const changed = edited.filter((t) => t.updatedAt && t.updatedAt.getTime() - t.createdAt.getTime() > 60000);
      return {
        desde: day(since),
        versoes_publicadas: versoes,
        livro_de_custo: costs.map((c) => ({
          quando: stamp(c.createdAt),
          ativo: c.security.ticker ?? c.security.name,
          tipo: c.kind,
          quantidade: c.quantity,
          preco_medio: c.unitCost,
          valor: r2(c.amount),
          vale_desde: day(c.date),
          fonte: c.source,
          motivo: c.reason,
          desfeito_em: stamp(c.revertedAt),
        })),
        avisos_aceitos: ignored.map((i) => ({ quando: stamp(i.createdAt), aviso: i.key })),
        lancamentos_alterados: { quantidade: changed.length, aviso: "só a partir de 25/11/2026", itens: changed.slice(0, 50).map((t) => ({ alterado_em: stamp(t.updatedAt), data: day(t.date), descricao: t.description, valor: r2(t.amount) })) },
      };
    })
  );
}
