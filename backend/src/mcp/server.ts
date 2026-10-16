// Conector do Claude (MCP) — 16/10, pedido do Luiz: "quero falar com o
// Claude no iPhone e ele ver minhas informações no Command OS, e me trazer
// dicas pra melhorar minha economia e onde investir". SÓ LEITURA: nenhuma
// ferramenta grava nada.
//
// As ferramentas chamam por dentro os MESMOS endpoints que a tela usa
// (budget-summary, wealth-overview, projects-summary...), com uma sessão
// interna de uso único — o Claude vê exatamente os números do app, sem uma
// segunda regra de cálculo pra divergir. Cada ferramenta enxuga a resposta
// (arredonda, corta listas longas) pra caber bem na conversa.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { createSessionToken, SESSION_COOKIE_NAME } from "../services/session.js";
import { categoryPath } from "../services/categorization.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const base = () => `http://127.0.0.1:${process.env.PORT ?? 3333}/api`;

async function api(path: string): Promise<Json> {
  const res = await fetch(`${base()}${path}`, { headers: { cookie: `${SESSION_COOKIE_NAME}=${createSessionToken()}` } });
  if (!res.ok) throw new Error(`${path} respondeu ${res.status}`);
  return res.json();
}

const r2 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 100) / 100);

function period(a: { mes?: number; ano?: number }) {
  const now = new Date();
  const month = a.mes ?? now.getMonth() + 1;
  const year = a.ano ?? now.getFullYear();
  return { month, year, q: `month=${month}&year=${year}` };
}

function reply(fn: (args: Json) => Promise<unknown>) {
  return async (args: Json) => {
    try {
      const result = await fn(args ?? {});
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 1) }] };
    } catch (e) {
      return { isError: true, content: [{ type: "text" as const, text: `Erro ao ler o Command OS: ${(e as Error).message}` }] };
    }
  };
}

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const mes = z.number().int().min(1).max(12).optional().describe("Mês 1–12 (padrão: mês atual)");
const ano = z.number().int().min(2018).max(2100).optional().describe("Ano (padrão: ano atual)");

// Gasto médio por mês nos N meses FECHADOS anteriores (despesa real, sem
// transferência) — base pra "reserva de emergência cobre X meses".
async function avgMonthlySpend(months: number) {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  const start = new Date(now.getFullYear(), now.getMonth() - months, 1);
  const agg = await prisma.transaction.aggregate({
    where: { type: "expense", isTransfer: false, date: { gte: start, lt: end } },
    _sum: { amount: true },
  });
  return r2((agg._sum.amount ?? 0) / months);
}

export function buildMcpServer() {
  const server = new McpServer(
    { name: "command-os", version: "0.1.0" },
    {
      instructions:
        "Finanças pessoais do Luiz no Command OS (command.luizrodrigues.com): orçamento, gastos, parcelas, patrimônio/investimentos e projetos (renda de freelancer). " +
        "Só leitura. Siga a skill \"command-os\": comece com `resumo_financeiro`, aprofunde com as outras ferramentas e responda com números reais, nunca de memória. " +
        "Valores em R$. Parcela de compra parcelada é gasto certo (nunca previsão). Conta corrente não conta como investimento.",
    }
  );

  server.registerTool(
    "resumo_financeiro",
    {
      title: "Resumo financeiro do mês",
      description:
        "Visão geral de um mês: gasto x planejado, entradas, sobra, maiores categorias, categorias que estouraram, meta diária, patrimônio total e variação, " +
        "alocação, aporte e proventos do mês, meta do primeiro milhão, a receber de projetos, parcelas do mês e dos próximos meses e gasto médio mensal (base da reserva de emergência). " +
        "Use no início de toda conversa sobre dinheiro.",
      inputSchema: { mes, ano },
      annotations: readOnly,
    },
    reply(async (a) => {
      const p = period(a);
      const [b, w, pr, inst, avg6, avg12] = await Promise.all([
        api(`/budget-summary?${p.q}`),
        api(`/wealth-overview?${p.q}`),
        api(`/projects-summary?${p.q}`),
        api(`/upcoming-installments?${p.q}`),
        avgMonthlySpend(6),
        avgMonthlySpend(12),
      ]);
      const byParent = new Map<string, number>();
      for (const c of b.categories) byParent.set(c.parentName ?? c.name, (byParent.get(c.parentName ?? c.name) ?? 0) + c.spent);
      return {
        periodo: `${String(p.month).padStart(2, "0")}/${p.year}`,
        orcamento: {
          gasto: r2(b.totalSpent),
          planejado: r2(b.totalPlanned),
          sobra_do_planejado: r2(b.totalPlanned - b.totalSpent),
          entradas: r2(b.totalIncome),
          entradas_de_projetos: r2(b.incomeFromProjects),
          entradas_mes_anterior: r2(b.previousTotalIncome),
          maiores_categorias: [...byParent.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([nome, valor]) => ({ nome, gasto: r2(valor) })),
          estouraram: b.categories
            .filter((c: Json) => c.spent > c.planned)
            .map((c: Json) => ({ categoria: `${c.parentName ? c.parentName + " > " : ""}${c.name}`, gasto: r2(c.spent), planejado: r2(c.planned), passou: r2(c.spent - c.planned) }))
            .sort((x: Json, y: Json) => y.passou - x.passou),
          maior_compra: b.biggestPurchase ? { descricao: b.biggestPurchase.description, valor: r2(b.biggestPurchase.amount), categoria: b.biggestPurchase.category } : null,
          meta_diaria: b.dailyGoal,
          dias_abaixo_da_meta: `${b.daysUnderGoal} de ${b.daysWithGoal}`,
          gasto_medio_por_dia: r2(b.monthlyAvgDailySpend),
        },
        gasto_medio_mensal: { ultimos_6_meses: avg6, ultimos_12_meses: avg12 },
        parcelas: {
          total_do_mes: r2(inst.total),
          proximos_meses: inst.byMonth.slice(0, 6).map((m: Json) => ({ mes: `${m.month}/${m.year}`, total: r2(m.amount) })),
          terminam_no_mes: inst.ending.length,
          liberam_por_mes_depois: r2(inst.endingTotal),
        },
        patrimonio: w.hasData
          ? {
              total: r2(w.total),
              mes_anterior: r2(w.previousTotal),
              aportado_no_mes: r2(w.investedThisMonth),
              proventos_no_mes: r2(w.dividendsThisMonth),
              proventos_no_ano: r2(w.dividendsThisYear),
              rendimento_medio_mensal_pct: r2(w.avgMonthlyReturnPct),
              alocacao: w.allocation
                .filter((x: Json) => x.value > 0)
                .sort((x: Json, y: Json) => y.value - x.value)
                .map((x: Json) => ({ classe: x.label, valor: r2(x.value), pct: r2((x.value / w.total) * 100) })),
              meta_primeiro_milhao: w.wealthGoal
                ? { alvo: w.wealthGoal.targetAmount, aporte_mensal_planejado: w.wealthGoal.monthlyContribution, progresso_pct: r2((w.total / w.wealthGoal.targetAmount) * 100), projecao: w.projection }
                : null,
            }
          : null,
        projetos: {
          recebido_no_mes: r2(pr.receivedThisMonth),
          recebido_no_ano: r2(pr.receivedThisYear),
          media_mensal_no_ano: r2(pr.avgMonthlyThisYear),
          a_receber: r2(pr.outstanding),
          valor_da_diaria: r2(pr.dailyRateThisMonth),
        },
      };
    })
  );

  server.registerTool(
    "orcamento",
    {
      title: "Orçamento por categoria",
      description: "Cada categoria do mês: planejado, gasto, gasto no mês anterior e diferença. Use pra achar onde cortar e o que cresceu.",
      inputSchema: { mes, ano },
      annotations: readOnly,
    },
    reply(async (a) => {
      const p = period(a);
      const b = await api(`/budget-summary?${p.q}`);
      return {
        periodo: `${String(p.month).padStart(2, "0")}/${p.year}`,
        categorias: b.categories
          .map((c: Json) => ({
            categoria: `${c.parentName ? c.parentName + " > " : ""}${c.name}`,
            tipo: c.kind === "essential" ? "essencial" : "não essencial",
            planejado: r2(c.planned),
            gasto: r2(c.spent),
            mes_anterior: r2(c.previousSpent),
            diferenca_do_planejado: r2(c.planned - c.spent),
          }))
          .sort((x: Json, y: Json) => y.gasto - x.gasto),
      };
    })
  );

  server.registerTool(
    "gastos",
    {
      title: "Gastos do mês",
      description:
        "Lançamentos de despesa do mês (o que, quanto, quando, categoria, cartão, parcela N/total), com total por categoria. Filtro opcional por texto da categoria (ex: \"Alimentação\", \"Uber\"). Use pra achar assinaturas, recorrentes e gastos que pesam.",
      inputSchema: {
        mes,
        ano,
        categoria: z.string().optional().describe("Parte do nome da categoria (ex: Restaurante, Moradia)"),
        limite: z.number().int().min(1).max(300).optional().describe("Máximo de lançamentos (padrão 80, maiores primeiro)"),
      },
      annotations: readOnly,
    },
    reply(async (a) => {
      const p = period(a);
      const txs: Json[] = await api(`/transactions?${p.q}`);
      const rows: { data: string; descricao: string; valor: number; categoria: string; cartao: string | null; parcela: string | null }[] = [];
      for (const t of txs) {
        if (t.type !== "expense" || t.isTransfer) continue;
        const base = { data: String(t.date).slice(0, 10), descricao: t.note || t.description, cartao: t.broker?.name ?? null, parcela: t.installmentNumber && t.totalInstallments ? `${t.installmentNumber}/${t.totalInstallments}` : null };
        if (t.splits?.length) for (const s of t.splits) rows.push({ ...base, valor: s.amount, categoria: s.categoryPath ?? "Sem categoria" });
        else rows.push({ ...base, valor: t.amount, categoria: t.categoryPath ?? "Sem categoria" });
      }
      const filtro = a.categoria?.toLowerCase();
      const filtered = filtro ? rows.filter((r) => r.categoria.toLowerCase().includes(filtro)) : rows;
      const porCategoria = new Map<string, number>();
      for (const r of filtered) porCategoria.set(r.categoria, (porCategoria.get(r.categoria) ?? 0) + r.valor);
      return {
        periodo: `${String(p.month).padStart(2, "0")}/${p.year}`,
        total: r2(filtered.reduce((s, r) => s + r.valor, 0)),
        quantidade: filtered.length,
        por_categoria: [...porCategoria.entries()].sort((x, y) => y[1] - x[1]).map(([categoria, total]) => ({ categoria, total: r2(total) })),
        lancamentos: filtered
          .sort((x, y) => y.valor - x.valor)
          .slice(0, a.limite ?? 80)
          .map((r) => ({ ...r, valor: r2(r.valor) })),
      };
    })
  );

  server.registerTool(
    "parcelas",
    {
      title: "Compras parceladas",
      description: "Parcelas do mês (todas, já lançadas ou não), total por cartão, total dos próximos meses e as compras que terminam no mês (quanto deixa de sair por mês depois).",
      inputSchema: { mes, ano },
      annotations: readOnly,
    },
    reply(async (a) => {
      const p = period(a);
      const r = await api(`/upcoming-installments?${p.q}`);
      const row = (i: Json) => ({
        data: String(i.dueDate).slice(0, 10),
        descricao: i.note ?? i.description,
        valor: r2(i.amount),
        parcela: i.installmentNumber && i.totalInstallments ? `${i.installmentNumber}/${i.totalInstallments}` : null,
        cartao: i.cardLabel,
        categoria: i.category,
      });
      return {
        periodo: `${String(p.month).padStart(2, "0")}/${p.year}`,
        total_do_mes: r2(r.total),
        por_cartao: r.byCard.map((c: Json) => ({ cartao: c.card, total: r2(c.amount) })),
        proximos_meses: r.byMonth.map((m: Json) => ({ mes: `${m.month}/${m.year}`, total: r2(m.amount) })),
        terminam_no_mes: { total: r2(r.endingTotal), compras: r.ending.map(row) },
        parcelas: r.installments.map(row),
      };
    })
  );

  server.registerTool(
    "patrimonio",
    {
      title: "Patrimônio e investimentos",
      description:
        "Carteira no mês: total, evolução de 12 meses, alocação por classe, cada posição (corretora, tipo, valor de mercado, investido, ganho, taxa, vencimento), " +
        "aportes por mês com detalhe por corretora, proventos por mês e por ativo, e o que mais rendeu/caiu. Use pra analisar diversificação, liquidez, reserva de emergência e onde alocar aportes e proventos.",
      inputSchema: { mes, ano },
      annotations: readOnly,
    },
    reply(async (a) => {
      const p = period(a);
      const [w, pos] = await Promise.all([api(`/wealth-overview?${p.q}`), api(`/positions?${p.q}`)]);
      if (!w.hasData) return { aviso: "Sem dado de patrimônio ainda." };
      return {
        periodo: `${String(p.month).padStart(2, "0")}/${p.year}`,
        total: r2(w.total),
        mes_anterior: r2(w.previousTotal),
        evolucao_12_meses: w.evolution.map((e: Json) => ({ mes: e.label, total: r2(e.value) })),
        rendimento_medio_mensal_pct: r2(w.avgMonthlyReturnPct),
        alocacao: w.allocation
          .filter((x: Json) => x.value > 0)
          .sort((x: Json, y: Json) => y.value - x.value)
          .map((x: Json) => ({ classe: x.label, valor: r2(x.value), pct: r2((x.value / w.total) * 100) })),
        posicoes: pos.byType.flatMap((g: Json) =>
          g.positions
            .filter((x: Json) => x.marketValue > 0)
            .map((x: Json) => ({
              grupo: g.type,
              ativo: x.ticker ? `${x.ticker} · ${x.name}` : x.name,
              corretora: x.broker,
              emissor: x.issuer,
              valor_mercado: r2(x.marketValue),
              investido: r2(x.investedAmount),
              ganho: r2(x.marketValue - x.investedAmount),
              taxa_contratada_anual: r2(x.fixedAnnualRate),
              vencimento: x.dueDate ? String(x.dueDate).slice(0, 10) : null,
              proventos_no_mes: r2(x.dividends),
              proventos_acumulados: r2(x.totalDividends),
            }))
        ),
        aportes_por_mes: w.investedByMonth.map((m: Json) => ({
          mes: m.label,
          total: r2(m.value),
          detalhe: (m.breakdown ?? []).map((d: Json) => ({ origem: d.label, valor: r2(d.value) })),
        })),
        proventos: {
          no_mes: r2(w.dividendsThisMonth),
          no_ano: r2(w.dividendsThisYear),
          por_mes: (w.dividendsByMonth ?? []).map((m: Json) => ({ mes: m.label, total: r2(m.value) })),
          por_ativo_no_mes: (w.dividendsBreakdown ?? []).map((d: Json) => ({ ativo: d.label, tipo: d.type, valor: r2(d.value) })),
        },
        mais_renderam: (w.positionMovers ?? []).slice(0, 5).map((m: Json) => ({ ativo: m.label, tipo: m.type, variacao_pct: r2(m.changePct) })),
        mais_cairam: [...(w.positionMovers ?? [])].reverse().slice(0, 5).map((m: Json) => ({ ativo: m.label, tipo: m.type, variacao_pct: r2(m.changePct) })),
        meta_primeiro_milhao: w.wealthGoal
          ? { alvo: w.wealthGoal.targetAmount, aporte_mensal_planejado: w.wealthGoal.monthlyContribution, projecao: w.projection, por_ano: w.yearlyBreakdown }
          : null,
      };
    })
  );

  server.registerTool(
    "projetos",
    {
      title: "Projetos (renda de freelancer)",
      description: "Recebido no mês e no ano, média mensal, a receber, valor da diária, imposto, ganhos por cliente e projetos em aberto. Use pra entender a renda variável.",
      inputSchema: { mes, ano },
      annotations: readOnly,
    },
    reply(async (a) => {
      const p = period(a);
      const [s, list] = await Promise.all([api(`/projects-summary?${p.q}`), api(`/projects`)]);
      return {
        periodo: `${String(p.month).padStart(2, "0")}/${p.year}`,
        recebido_no_mes: r2(s.receivedThisMonth),
        recebido_mes_anterior: r2(s.receivedLastMonth),
        recebido_no_ano: r2(s.receivedThisYear),
        media_mensal_no_ano: r2(s.avgMonthlyThisYear),
        recebido_por_mes: s.monthlyReceived.map((m: Json) => ({ mes: m.label, valor: r2(m.value) })),
        a_receber: r2(s.outstanding),
        valor_da_diaria: r2(s.dailyRateThisMonth),
        receita_bruta_total: r2(s.grossRevenue),
        receita_liquida_total: r2(s.netRevenue),
        imposto_pago_no_ano: r2(s.taxPaidThisYear),
        receita_por_cliente_no_ano: s.clientRevenue.map((c: Json) => ({ cliente: c.label, valor: r2(c.value) })),
        em_aberto: list
          .filter((x: Json) => x.status === "em_andamento" || x.status === "pausado")
          .map((x: Json) => ({ projeto: `${x.client.name} · ${x.name}`, status: x.status, contrato: r2(x.contractValue), recebido: r2(x.received), falta: r2(x.remaining) })),
      };
    })
  );

  server.registerTool(
    "historico_mensal",
    {
      title: "Histórico mês a mês",
      description: "Últimos N meses fechados + o atual: gasto total, entradas, sobra (entradas − gasto) e as 5 categorias-mãe que mais pesaram em cada mês. Use pra tendências e sazonalidade.",
      inputSchema: { meses: z.number().int().min(2).max(24).optional().describe("Quantos meses (padrão 12)") },
      annotations: readOnly,
    },
    reply(async (a) => {
      const n = a.meses ?? 12;
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - (n - 1), 1);
      const [txs, splits] = await Promise.all([
        prisma.transaction.findMany({
          where: { isTransfer: false, date: { gte: start } },
          select: { date: true, amount: true, type: true, category: { include: { parent: { include: { parent: true } } } }, splits: { select: { id: true } } },
        }),
        prisma.transactionSplit.findMany({
          where: { transaction: { isTransfer: false, type: "expense", date: { gte: start } } },
          select: { amount: true, transaction: { select: { date: true } }, category: { include: { parent: { include: { parent: true } } } } },
        }),
      ]);
      const parentOf = (c: Json) => (c ? (categoryPath(c) ?? c.name).split(" > ")[0] : "Sem categoria");
      const months = new Map<string, { gasto: number; entradas: number; cats: Map<string, number> }>();
      const bucket = (d: Date) => {
        const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (!months.has(k)) months.set(k, { gasto: 0, entradas: 0, cats: new Map() });
        return months.get(k)!;
      };
      for (const t of txs) {
        const m = bucket(t.date);
        if (t.type === "income") m.entradas += t.amount;
        else if (t.type === "expense") {
          m.gasto += t.amount;
          if (t.splits.length === 0) m.cats.set(parentOf(t.category), (m.cats.get(parentOf(t.category)) ?? 0) + t.amount);
        }
      }
      for (const s of splits) {
        const m = bucket(s.transaction.date);
        m.cats.set(parentOf(s.category), (m.cats.get(parentOf(s.category)) ?? 0) + s.amount);
      }
      return [...months.entries()]
        .sort((x, y) => x[0].localeCompare(y[0]))
        .map(([mes, m]) => ({
          mes,
          gasto: r2(m.gasto),
          entradas: r2(m.entradas),
          sobra: r2(m.entradas - m.gasto),
          principais_categorias: [...m.cats.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([categoria, valor]) => ({ categoria, valor: r2(valor) })),
        }));
    })
  );

  return server;
}
