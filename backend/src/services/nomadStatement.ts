// Extrai posições do extrato PDF da Nomad (formato Apex Clearing) — texto
// puro via pdf-parse, sem OCR/IA, só regex contra a estrutura conhecida do
// documento. Isso é sempre "melhor esforço": nunca grava direto no banco,
// só devolve uma prévia (ver routes/brokers.ts) pra confirmação manual antes
// de qualquer PositionSnapshot ser criado — um extrato com layout diferente
// não corrompe dado, na pior das hipóteses falha em extrair e mostra aviso.

export interface ParsedNomadPosition {
  name: string;
  cusip: string;
  quantity: number;
  unitValue: number;
  marketValue: number;
  type: string;
}

/** Chute de tipo pelo nome — sempre revisável na tela de confirmação, não é
 * definitivo. "%," é o jeito como bond de cupom aparece no extrato (ex:
 * "NVIDIA CORP. 1.55%, 06/15/2028"); ETF é o único fundo que já apareceu. */
function guessType(name: string): string {
  if (/\bETF\b/i.test(name)) return "Fundo";
  if (/\d+(\.\d+)?%,/.test(name)) return "Renda Fixa";
  return "Renda Fixa";
}

export interface ParsedNomadStatement {
  positions: ParsedNomadPosition[];
  fdicBalance: number | null;
  totalNetWorth: number | null;
  securitiesValuation: number | null;
  periodEnd: string | null; // "2026-07-31"
  warnings: string[];
}

function parseNum(s: string): number {
  return Number(s.replace(/,/g, ""));
}

export function parseNomadStatement(text: string): ParsedNomadStatement {
  const warnings: string[] = [];

  // Período do extrato: "2026-07-01 - 2026-07-31" — usa a data final (fecha
  // o período, é o "saldo de fim de mês" que a gente grava).
  const periodMatch = text.match(/(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})/);
  const periodEnd = periodMatch ? periodMatch[2] : null;

  // Resumo (ACCOUNT SUMMARY) — usados como conferência, não como fonte da posição.
  const fdicMatch = text.match(/FDIC Insured Deposits\s+([\d,.]+)\s+([\d,.]+)/);
  const fdicBalance = fdicMatch ? parseNum(fdicMatch[2]) : null;
  const netWorthMatch = text.match(/Total Net Worth\s+([\d,.]+)\s+([\d,.]+)/);
  const totalNetWorth = netWorthMatch ? parseNum(netWorthMatch[2]) : null;
  const securitiesMatch = text.match(/Securities Valuation\s+([\d,.]+)\s+([\d,.]+)/);
  const securitiesValuation = securitiesMatch ? parseNum(securitiesMatch[2]) : null;

  // Tabela PORTFOLIO: bloco entre o cabeçalho "PORTFOLIO" e o próximo "Total"
  // (fim da tabela) ou próxima seção maiúscula.
  const portfolioStart = text.indexOf("PORTFOLIO");
  if (portfolioStart === -1) {
    warnings.push('Seção "PORTFOLIO" não encontrada no PDF — layout pode ter mudado.');
    return { positions: [], fdicBalance, totalNetWorth, securitiesValuation, periodEnd, warnings };
  }
  const afterHeader = text.slice(portfolioStart + "PORTFOLIO".length);
  const tableEnd = afterHeader.search(/\n\s*Total\s+[\d,.]+\s+[\d,.]+/);
  const tableText = tableEnd === -1 ? afterHeader : afterHeader.slice(0, tableEnd);

  // O cabeçalho de coluna da tabela ("Description Symbol / CUSIP / Quantity
  // Securities on / Loan / Price($) Market Value..." etc.) quebra linha de
  // um jeito que varia com a extração de texto — em vez de listar toda
  // variação possível, corta tudo até a âncora estável do fim do cabeçalho
  // ("% of Total" seguido de "Portfolio", a última coluna).
  const headerAnchor = tableText.match(/%\s+of\s+Total\s*\n\s*Portfolio\s*\n/);
  const contentText = headerAnchor ? tableText.slice(headerAnchor.index! + headerAnchor[0].length) : tableText;
  if (!headerAnchor) warnings.push('Cabeçalho da tabela de posições não reconhecido — pode ter texto de coluna misturado na primeira posição, confira.');

  const lines = contentText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Linha de dado numérico: quantidade, ativos emprestados, preço, valor de
  // mercado, valor de mercado do período anterior, %variação, %do portfólio.
  const dataLineRe = /^([\d,]+\.\d+)\s+\d+\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)\s+[\d,]+\.\d+\s+-?[\d.]+\s+[\d.]+$/;
  const cusipRe = /\s([0-9A-Z]{8,9})$/;

  const positions: ParsedNomadPosition[] = [];
  let pendingDescription: string[] = [];
  for (const line of lines) {
    // pula linha de cabeçalho de página que às vezes se repete no meio da
    // tabela (extrato de várias páginas)
    if (/^(Page \d+ of \d+|-- \d+ of \d+ --|Description|Symbol|CUSIP|Quantity|Price\(\$\)|Market Value|% Change|% of Total|Portfolio|Securities on|Loan|Previous Period)/.test(line)) {
      continue;
    }
    const match = line.match(dataLineRe);
    if (!match) {
      pendingDescription.push(line);
      continue;
    }
    const [, quantityStr, priceStr, marketValueStr] = match;
    const rawName = pendingDescription.join(" ").replace(/\s+/g, " ").trim();
    const cusipMatch = rawName.match(cusipRe);
    const cusip = cusipMatch ? cusipMatch[1] : "";
    const name = cusip ? rawName.slice(0, cusipMatch!.index).trim() : rawName;
    if (!name || !cusip) {
      warnings.push(`Linha de valor sem descrição/CUSIP reconhecível: "${rawName}" — pulada, confira manualmente.`);
    } else {
      positions.push({
        name,
        cusip,
        quantity: parseNum(quantityStr),
        unitValue: parseNum(priceStr),
        marketValue: parseNum(marketValueStr),
        type: guessType(name),
      });
    }
    pendingDescription = [];
  }

  // Conferência: soma das posições deveria bater com "Securities Valuation".
  if (securitiesValuation != null && positions.length > 0) {
    const sum = positions.reduce((s, p) => s + p.marketValue, 0);
    if (Math.abs(sum - securitiesValuation) > 0.05) {
      warnings.push(`Soma das posições (${sum.toFixed(2)}) não bate com "Securities Valuation" do extrato (${securitiesValuation.toFixed(2)}) — confira antes de confirmar.`);
    }
  }

  return { positions, fdicBalance, totalNetWorth, securitiesValuation, periodEnd, warnings };
}
