# Blueprint — Modelo de Dados

Versão em markdown do [Blueprint Financeiro](https://claude.ai/code/artifact/f5339da9-c43d-4928-87b3-7c33899e3011) (artifact vivo, com mais contexto visual). Este arquivo é a referência que fica versionada junto do código — atualize os dois quando o modelo mudar.

Fontes originais: planilhas Google Sheets "ORÇAMENTO — PESSOAL - 2026", "PLANEJAMENTO - PESSOAL" e "PLANEJAMENTO - 2026" (Projetos).

## Decisões de arquitetura fixadas

- **Entrega**: PWA (não app nativo — evita taxa da App Store e expiração de build sem conta paga)
- **Tudo self-hosted no Digital Ocean do Luiz** — sem serviço externo pago por padrão. Único serviço externo aceito: **Pluggy** (Open Finance), porque não existe alternativa self-hosted pra ler dados bancários — e mesmo assim, arquitetado como camada plugável (nunca dependência única, sempre com fallback manual)
- **Ordem de construção**: estrutura → backend/mecânica → UI por último (Luiz é designer e quer explorar a interface com calma, sabendo exatamente o que cada tela precisa suportar)
- **Stack**: Node.js + Express + Prisma + SQLite (backend), React/Vite PWA (frontend)
- **Local do projeto**: `~/Desktop/Work/CLAUDE/Financial-Hub` (é aqui que Luiz pediu desde o início). Em 20/08 esse local tinha travado com `EPERM: operation not permitted` em qualquer `npm`/`node` — não era ACL nem pasta corrompida, era o **Full Disk Access do macOS nunca concedido pro terminal** (Ajustes → Privacidade e Segurança → Arquivos e Pastas/Acesso Total ao Disco): sem isso, `stat`/`cd` funcionam mas `ls`/`cp`/abrir arquivo em Desktop/Downloads/Documents são bloqueados — sintoma idêntico a permissão de Unix quebrada, causa raiz totalmente diferente. Resolvido em 24/08 (Luiz concedeu a permissão); o projeto foi temporariamente clonado em `~/Desktop/Financial-Hub` como contorno enquanto isso não se resolvia — **esse clone antigo pode ser apagado**, tudo que importava (código + banco) já foi trazido de volta pra cá.

## Módulo 1 — Financeiro Pessoal

### Transaction
A tabela central — todo dinheiro que entra ou sai.

| Campo | Tipo | Nota |
|---|---|---|
| id | uuid | |
| date | date | |
| type | enum | income \| expense |
| description | text | |
| category_id | → Category | |
| amount | decimal | |
| recurrence_id | → Recurrence \| null | |
| source | enum | manual \| pluggy \| ofx_import |
| external_id | text \| null | evita duplicar import |
| broker_id | → Broker \| null | de qual instituição veio |
| is_transfer | bool | true = não conta como gasto/receita real (fatura de cartão, empréstimo concedido/reembolsado) |
| tax_payment_id | → TaxPayment \| null | |
| project_receipt_id | → ProjectReceipt \| null | |
| supplier_payment_id | → SupplierPayment \| null | |
| loan_receivable_id | → LoanReceivable \| null | |

### Recurrence
Resolve parcela e assinatura sem duplicar linha manualmente todo mês. Reaproveitada também por `Project` (cliente fixo tipo retainer).

| Campo | Tipo | Nota |
|---|---|---|
| id | uuid | |
| frequency | enum | monthly |
| installments | int \| null | null = recorrente sem fim |
| start_date | date | |

### Category
Suporta subcategoria (aponta pra si mesma) e uma tag pessoal/trabalho.

| Campo | Tipo | Nota |
|---|---|---|
| id | uuid | |
| name | text | |
| parent_id | → Category \| null | null = categoria-mãe |
| type | enum | income \| expense |
| essential | bool | só expense |
| usage | enum \| null | pessoal \| trabalho |

**Lista final de categorias (expense):**
- **Moradia**: Aluguel, Luz, Gás, Água
- **Assinaturas Digitais**: Adobe·trabalho, Figma·trabalho, Apple·pessoal, Gmail·trabalho, Servidor·trabalho, Domínio·trabalho
- **Transporte**: Uber, 99, Táxi, Locação de Carro
- **Gastos Médicos**: Plano, Farmácia, Consultas, Exames
- **Compras** (sem subcategoria — Luiz não usa "Roupas" vs "Shopping" na prática)
- **Salões**: Barbeiro, Manicure
- **Viagens**: Hospedagem, Passeios
- **Gastos Jurídicos**: Documentos, Cartas, Justiça
- **Equipamentos**: Home, Câmera, Notebook·trabalho, Usina Solar (parcelada no cartão)
- **DAS**, **INSS**, **Contador** (separadas — antes eram uma única "Imposto-Contador")
- **Lazer** (Games, Cinema, etc.) — ainda **em aberto**, Luiz não decidiu se consolida

**Income**: uma categoria por `Client` do módulo Projetos (ver Ponte entre módulos).

### BudgetTarget / DailySpendGoal

```
BudgetTarget: category_id, month, year, planned_amount   (o "Realizado" é SUM(Transaction), nunca digitado)
DailySpendGoal: amount                                    (hoje R$150/dia)
```

### Debt / DebtInstallment
Dinheiro que **Luiz deve** (empréstimo do Tio João — 24x R$2.918,70).

```
Debt: creditor, installment_amount, installment_count, start_date
DebtInstallment: debt_id, due_date, paid (bool), paid_amount
```

### LoanReceivable / LoanReceivableRepayment
Espelho do Debt — dinheiro que **devem a Luiz** (emprestou pro tio e pra irmã). Ambas as pontas (emprestar e reembolsar) são `Transaction.is_transfer = true`.

```
LoanReceivable: borrower, principal_amount, loan_date
LoanReceivableRepayment: loan_receivable_id, amount, payment_date
```

### Broker
Qualquer instituição conectada — banco ou corretora. Usada tanto por `Transaction` quanto por `PositionSnapshot`.

| Campo | Tipo | Nota |
|---|---|---|
| id | uuid | |
| name | text | BTG, C6, Caixa, 99, Phantom, Nomad, Mercado Pago, Sofisa, Wise, INCO |
| scope | enum[] | transactions \| credit_card \| investments |
| data_source | enum | pluggy \| manual_statement \| onchain_query |
| pluggy_connector_id | text \| null | |
| onchain_address | text \| null | endereço público (Phantom) |
| last_synced_at | datetime | |

**Conexão via Pluggy — status real (sincronizado em 24/08/2026):**
Luiz já tinha os 4 bancos conectados direto no app pessoal "Meu Pluggy" antes de existir a tela `/configuracoes` — os `itemId` foram registrados manualmente nos `Broker` e sincronizados via `POST /api/brokers/:id/sync`. Resultado real (`PositionSnapshot` gravados):
- **BTG** → 58 posições sincronizadas.
- **Sofisa** → 81 posições sincronizadas. **Corrige o teste manual de 20/08**, que tinha concluído "investimento não veio" — na verdade veio, só não tinha sido sincronizado pelo pipeline ainda.
- **C6** → 1 posição.
- **99** → 0 posições (sem produto de investimento nessa conta, como já era esperado pra esse tipo de conta).
- Todos os 4 vieram com `connector.name = "MeuPluggy"` na resposta da Pluggy (é o conector genérico do app pessoal, não o nome do banco) — por isso o `Broker.name` usa o apelido real (BTG/C6/99/Sofisa) informado por Luiz, não o que a API devolve.

A tela **Conexões** (`/configuracoes`, widget `pluggy-connect-sdk`) existe pra **daqui pra frente**: reconectar (MFA vencido) ou conectar um banco novo sem precisar desse processo manual — login bancário sempre dentro do iframe da Pluggy, nunca passa pelo nosso backend.
- Mercado Pago → Pluggy confirma que **não** suporta investimentos (só conta) — resta como possível fonte de transação, não de patrimônio.
- Nomad, Wise, INCO → extrato manual (sem conector na Pluggy).
- Phantom → consulta direta na blockchain Solana via endereço público (não é Pluggy) — ainda não implementado.

### Security / PositionSnapshot / WealthGoal / WealthGoalYearly

```
Security: name, ticker, type (FII|Ação|Renda Fixa|Cripto|Moeda|Fundo), sector, target_allocation_pct, target_dividend_yield
PositionSnapshot: broker_id, security_id, month, year, invested_amount, market_value, dividends
WealthGoal: target_amount                                          (singleton — só o valor alvo do "1º milhão")
WealthGoalYearly: year, savings_target, annual_return_assumption_pct (uma linha por ano — espelha a aba "Primeira Milha(o)" da planilha)
```
`WealthGoal` era originalmente uma taxa/aporte único valendo pra sempre; virou `WealthGoalYearly` (24/08/2026) porque na planilha real cada ano tinha sua própria meta de aporte — ano sem linha configurada extrapola a última (ver fórmula abaixo).

### CategorizationRule
Pré-populada com o padrão real da planilha (~1.170 linhas já categorizadas).

```
CategorizationRule: pattern (ex: "uber"), category_id, confidence
```

## Módulo 2 — Projetos & Freelance

### Client / Project

```
Client: name

Project:
  client_id, name, start_date, end_date, contract_value,
  has_invoice (NF), installment_count,
  status: em_andamento | pausado | finalizado | cancelado,
  recurrence_id → Recurrence | null   (cliente fixo tipo retainer, ex: "Cliente → Rental - {Mês}")
```

**Cortado do modelo original**: divisão Prolabore/Caixa — Luiz confirmou que nunca usou, todo líquido vira dinheiro pessoal.

### ProjectReceipt (o ledger real de recebimento)

```
ProjectReceipt: project_id, installment_number, amount (valor cheio, sem desconto), payment_date
```

### TaxPayment (DAS)
Corrige a % fixa (6%) que a planilha assumia — na real é variável, calculada sobre o total faturado no mês, paga no dia 20 do mês seguinte.

```
TaxPayment: competence_month, total_revenue (= SUM(ProjectReceipt) por data de recebimento — ⚠️ assunção a confirmar, ver Pendências), amount_paid, effective_rate (calculada), payment_date
```

### Supplier / ProjectSupplierCost / SupplierPayment

```
Supplier: name
ProjectSupplierCost: project_id, supplier_id, agreed_amount, installment_count
SupplierPayment: project_supplier_cost_id, installment_number, amount, payment_date
```

## Ponte entre os módulos

| Evento em Projetos | Vira em Financeiro Pessoal | Categoria |
|---|---|---|
| ProjectReceipt | Transaction income, valor cheio | nome do Client |
| TaxPayment (DAS) | Transaction expense | DAS |
| SupplierPayment | Transaction expense | (do fornecedor) |

O DAS mantém a data real do pagamento (ex: agosto) mas carrega `tax_payment_id`, que aponta pro `TaxPayment` com `competence_month` correto (ex: julho) — o overview mostra "DAS — referente a julho" sem bagunçar a data real do gasto.

## Status de implementação

Log vivo do que já está de pé, pra não perder o fio conforme o projeto cresce — atualizar sempre que uma rota ou tela nova entrar no ar.

### Backend (rotas reais, sem mock)

| Rota | O que faz |
|---|---|
| `GET/POST /api/transactions` | lista/cria lançamento |
| `GET /api/categories` | árvore categoria-mãe + subcategorias |
| `GET /api/budget-summary?month&year` | orçamento total do mês + por categoria, comparado com o mês anterior; meta diária + gasto real dos últimos 14 dias |
| `GET /api/wealth-overview` | patrimônio total, evolução (12 meses), alocação por tipo de ativo, destaques do mês (maior variação % por security), aportes/proventos do mês, e a projeção do 1º milhão |
| `GET /api/projects-summary?year` | recebido no mês/ano, imposto pago, a receber, recebido por mês (série), receita por cliente, projetos ativos |
| `GET /api/brokers`, `POST /api/brokers/:id/sync` | lista corretoras/bancos conectados; sync puxa `/investments` da Pluggy e grava `PositionSnapshot` |
| `POST /api/pluggy/connect-token` | gera o token do widget (com ou sem `itemId`, pra conectar novo ou reautenticar) |
| `POST /api/pluggy/link-broker` | grava/atualiza o `Broker` quando o widget retorna sucesso |
| `GET/PUT /api/wealth-goal` | lê/define o valor alvo geral (singleton) |
| `PUT/DELETE /api/wealth-goal/yearly/:year` | cria/atualiza/remove a meta (aporte + retorno assumido) de um ano específico |

Todas calculam em cima do banco (Prisma/SQLite) — nenhum número fixo no código. Com o banco vazio, cada rota devolve zero/vazio de propósito (não é bug), e o Dashboard mostra estado vazio explicando o que falta (ex: "sincronize uma corretora").

### Fórmula da projeção "Primeira Milhão" (`services/wealthProjection.ts`, usada por `wealth-overview` → `projection`/`yearlyBreakdown`)

Simulação mês a mês (não fórmula fechada — mais fácil de auditar e de trocar premissa depois), usando a meta **do ano correspondente** a cada mês simulado — não uma taxa única pra sempre:

```
pra cada mês simulado, a partir de hoje:
  linha = WealthGoalYearly do ano daquele mês, OU a última configurada se aquele ano não tiver linha (extrapolação, sinalizada)
  taxa_mensal = (1 + linha.annual_return_assumption_pct/100) ^ (1/12) - 1
  aporte_mensal = linha.savings_target / 12
  saldo = saldo * (1 + taxa_mensal) + aporte_mensal
repete até saldo >= WealthGoal.target_amount (teto de segurança: 600 meses / 50 anos)
```
Devolve `{monthsToGoal, projectedDate, usedExtrapolation}` + `yearlyBreakdown` (tabela ano a ano: saldo inicial, aporte, saldo final — a versão "explícita" que fica na página de Patrimônio). Se estourar o teto, ou se não houver nenhum `WealthGoalYearly` configurado, mostra que a meta não é alcançável nas premissas atuais em vez de inventar uma data.

### Frontend

- `Dashboard.tsx` — 100% ligado nas rotas acima, zero `MOCK_*`. Card **Primeira Milhão** (resumo: % + data projetada, link "Ver tudo" pra Patrimônio); **Orçamento do mês** com total consolidado antes do detalhe por categoria.
- `Patrimonio.tsx` (rota `/patrimonio`, antes placeholder) — página real: evolução, **alocação de investimentos** (pizza por tipo de ativo), destaques do mês, e a seção **Primeira Milhão** completa (formulário de meta geral + tabela de metas por ano, editável, com adicionar/remover + tabela da projeção ano a ano).
  - **Uma box por tipo de ativo** (25/08) — cada tipo (Renda Fixa, FII, Ação, Fundo, Cripto) ou corretora `standalone` (Nomad) vira seu próprio card. "Por corretora" continua pizza (poucas fatias, funciona bem). "**Por ativo**": `RankedBarList` (barra horizontal ranqueada, top 8 + "Outros") pra a maioria; **Ação e FII usam `VerticalBarChart`** (barra vertical 100% da largura, maior barra destacada com gradiente do accent + rótulo em pill preto, até 12 itens + "Outros") — pizza/barra horizontal ficava ilegível com 15-25 posições. Fonte: `GET /api/positions` (agrupa por tipo, mesma regra de "posição ativa" de `wealth-overview`).
  - **Evolução por corretora** — quando o grupo só tem 1 corretora (Moeda→Nomad, Cripto→Phantom, Fundo→o fundo da BTG), não tem o que comparar por corretora/ativo, mas mostra a evolução mensal daquela corretora (`SmoothLineChart`, via `GET /api/positions/history?broker=`). Resolve concretamente "eu não invisto em Moeda, invisto na Nomad" — o gráfico já é por corretora, o tipo "Moeda" só existe pra classificar o ativo.
  - `assetLabel()` agrupa nomes tipo "CDB - BANCO SOFISA S.A." em "CDB" (corta no primeiro " - ") — sem isso a Sofisa sozinha gera 81 fatias/barras iguais.
  - `displayName()` só usa o `ticker` da Pluggy pra Ação/FII (é um ticker de verdade ali — PETR4, HGLG11); pra Renda Fixa/Fundo o "código" da Pluggy é um ISIN/CNPJ interno sem significado pra leitura, então usa o `name` completo.
  - Coluna "Cotas/qtd." na tabela — `PositionSnapshot.quantity`/`unitValue`, campos que a Pluggy manda (quantidade de cotas/ações + valor unitário) e que não estavam sendo guardados. `monthlyRatePct`/`annualRatePct` também foram adicionados ao schema mas vêm sempre `null` nesse tier de conta pessoal da Pluggy — não é bug, só não tem dado pra capturar ainda.

### Correções de classificação (25/08)

- **FII classificado como Ação**: a Pluggy manda FII (HGLG11, MXRF11, KNRI11, etc.) como `type: EQUITY` igual ação comum, sem `subtype: REAL_ESTATE_FUND` — `mapSecurityType()` agora reconhece por uma lista de prefixos de ticker conhecidos (`KNOWN_FII_PREFIXES`) antes de cair no type/subtype da Pluggy. 18 securities corrigidas retroativamente + `type` agora entra no `update` do upsert (não só no `create`), então um resync futuro corrige sozinho se a lista de prefixos crescer.
- **Mercado Pago removido** — Luiz não usa mais, broker + snapshots apagados do banco.
- **"EMERGENCIA" (99, Sofisa, Wise) renomeado pra "CDB - Liquidez Diária"** — é conceitualmente sempre um CDB de liquidez diária (confirmado por Luiz), em qualquer corretora; sem o prefixo "CDB - " cada um aparecia como fatia própria em vez de somar no grupo CDB do `assetLabel()`.
- `Conexoes.tsx` (rota `/configuracoes`) — widget da Pluggy embutido, lista de bancos conectados com Sincronizar/Reconectar.
- `CardHeader` (`components/CardHeader.tsx`) e `currency()` (`lib/format.ts`) viraram compartilhados — `Dashboard.module.css` virou `styles/cards.module.css`, o "kit de card" que qualquer página nova (Orçamento, Projetos) reaproveita em vez de duplicar.
- **Botão de adicionar (+)**: não existe mais como FAB global do shell — só aparece dentro de Orçamento/Patrimônio/Projetos, e cada página decide o que "adicionar" significa nela (sem tela de escolher tipo primeiro). Em Patrimônio, abre `POST /api/positions` — lançamento manual, só faz sentido pra corretora sem sync automático (Nomad, Wise, Phantom...); banco conectado recebe o aporte sozinho no sync, nunca precisa ser digitado.

### Nomad real (25/08) — extrato substitui estimativa da planilha

Luiz mandou o extrato oficial da Nomad (PDF, julho/2026). A posição "USD" agregada (estimativa do histórico manual) virou 4 posições reais e conferidas contra o documento:
- **NVIDIA CORP. 1.55%, 06/15/2028** (bond) — Renda Fixa
- **BRAZIL (FEDERATIVE REPUBLIC) 6.25%, 03/18/2031** (bond soberano) — Renda Fixa
- **ISHARES TR CORE 30 70 ETF** (ticker AOK) — Fundo
- **FDIC Insured Deposit** (caixa) — Moeda

Total conferido: US$ 7.675,52 bate exato com o "Total Net Worth" do extrato. `investedAmount` foi setado igual ao `marketValue` pra cada um — o extrato não traz preço de aquisição (é um resumo de posição, não nota de corretagem), então não tem como saber o ganho/perda real; assumir isso seria inventar número. Se Luiz mandar as notas de compra depois, dá pra corrigir.

### Phantom on-chain real (25/08, ampliado no mesmo dia)

`services/solana.ts` — consulta pública na blockchain Solana (RPC `api.mainnet-beta.solana.com`, sem chave), só com o endereço público da carteira (nunca a seed phrase). `Broker.dataSource = "onchain_query"` + `onchainAddress` preenchidos pro Phantom; `POST /api/brokers/:id/sync` já sabe rotear pra Pluggy ou on-chain de acordo com o `dataSource`.
- **SOL nativo + tokens SPL** (`getTokenAccountsByOwner`) — cobre a carteira inteira, não só SOL. Cada token achado é precificado via CoinGecko (`simple/token_price/solana` pelo endereço do contrato) e nomeado via `coins/solana/contract/{mint}`; token sem preço no CoinGecko (memecoin muito nova, sem liquidez) é **ignorado, não vira posição com valor 0 fake** — o sync devolve `tokensUnpriced` pra saber quantos ficaram de fora.
- Preço do SOL em BRL via CoinGecko (`simple/price`, público, sem chave).
- `investedAmount`: a blockchain não guarda preço de compra — herda o valor do snapshot anterior (mantém uma base de custo), ou usa o valor de mercado na primeira vez (equivale a "ainda não sei o ganho/perda", não inventa um número).
- A posição estimada antiga da planilha (R$1.258,11) foi substituída pelo saldo real (R$5,06 — SOL R$1,74 + um token SPL real, "Lux Token", R$3,32 — bem menos do que a estimativa manual supunha).

### Corretora "standalone" — Nomad vira sua própria box (25/08)

`Broker.standalone` (bool) — corretora marcada assim não entra no agrupamento por tipo de ativo em `/api/positions`; vira sua própria box, com TODAS as posições dela juntas não importa o tipo. Motivo: Nomad tem bond (Renda Fixa) e ETF (Fundo) — Luiz não pensa nisso como "duas gavetas diferentes", é uma carteira só, numa corretora só. `positions.ts` decide a chave de agrupamento por `broker.standalone ? broker.name : security.type` e marca `isBroker: true` na resposta pro frontend saber que aquele "type" ali é na verdade um nome de corretora (troca o ícone pra `Landmark`, não mostra pizza "por corretora" — só tem uma mesmo). Hoje só a Nomad tem essa flag.

### `services/activePositions.ts` — a fonte única de verdade pra "o que está ativo agora"

Usado por `wealth-overview` e por `positions` — nunca duplicar essa lógica. Resolve dois problemas reais que apareceram construindo "Todas as posições" (24/08/2026):

1. **Corretora sem sync recente**: se o snapshot mais novo de um broker tem mais de 2 meses, ele para de contar (senão uma corretora encerrada há anos, tipo XP Investimento parada desde 2022, ficaria pra sempre como "posição atual").
2. **Broker que migrou de planilha manual pra fonte automática** — Pluggy (BTG, C6, 99, Sofisa) ou on-chain (Phantom): o histórico manual agregava por categoria ("AÇÕES"/"CRYPTO" numa linha só) e a fonte automática reporta cada ativo individual (ou o saldo real da blockchain) — são o MESMO dinheiro, não dois. A partir do mês em que a fonte automática daquele broker começou (não retroativo — o histórico anterior continua manual normalmente), os `Security` com id `MANUAL:*` daquele broker somem do cálculo. Qualquer id `pluggy:*` ou `onchain:*` conta como "fonte automática" pra essa regra.

Sem isso, o "Patrimônio total" oscilava entre contar tudo em dobro ou faltar corretora inteira. Valor real após Nomad (extrato) e Phantom (on-chain): **R$601.559,81**.

### Import do histórico real (24/08/2026)

A planilha "PLANEJAMENTO - PESSOAL" tem uma aba de investimentos **por ano, de 2017 a 2026** (nomes de aba enganosos: "INVESTIMENTO 18" cobre set/2017–dez/2018, o número é o ano de fechamento, não o único ano dentro). Processo:

- Script único em `tmp-import/` (gitignored — tem a planilha real + `node_modules`, nunca commitar): `parse.js` lê o `.xlsx` (biblioteca `xlsx`) e reconstrói cada mês; `seed.js` grava no banco via Prisma, parando antes de agosto/2026 (dali em diante é a Pluggy que manda, nunca sobrescrever).
- Formato mudou ao longo dos anos (cabeçalho de mês por serial de data vs. texto "DD - MÊS(- ANO)"; rótulo de subtotal "PARCIAL" vs "TOTAL"). O parser cobre os dois, com inferência de ano por sequência (mês que "volta" pro início = virou o ano) quando a linha não tem ano explícito — e **desconfia de ano explícito que contradiz a sequência**: achou e corrigiu 2 erros de digitação reais na própria planilha (linhas que diziam "JANEIRO - 2021" e "JANEIRO - 2023" logo depois de Dezembro do mesmo ano, quando deveriam ser o ano seguinte).
- Resultado: **1316 `PositionSnapshot`** gravados, 18 `Broker` (incluindo corretoras extintas: XP Investimento, Easynvest/NuInvest, Nexoos, Monetus, PicPay, Órama, Binance, Inco), 75 `Security`.
- **Limitação conhecida, não contornável**: Nomad em 2022-2024 guarda "valor investido" em USD cru mas "valor líquido" já convertido pra BRL, sem a cotação usada ter sido salva em lugar nenhum — não dá pra reconstruir a taxa sem chutar. Essas 32 linhas foram puladas (não gravadas como zero nem estimadas).
- **Efeito colateral que forçou uma correção de verdade**: o histórico manual agregava por categoria ("AÇÕES" numa linha só); a Pluggy reporta cada ativo individual (BTG sozinho tem 58 posições). Isso quebrava a fórmula de "aporte do mês" (comparava por `securityId`, que muda de identidade entre as duas fontes) — corrigido trocando pra comparar **totais do período**, não posição por posição (ver `wealth.ts`). Efeito prático: o mês de transição (jul→ago/2026) mistura estimativa manual com dado exato da Pluggy, então o número daquele mês específico pode não bater 100%; setembro/2026 em diante já é Pluggy-vs-Pluggy, exato.

### Refinamentos de Patrimônio (25/08, segunda rodada) — espaçamento, hover genérico, USD, gráfico de barra

- **`components/HoverCard.tsx`** — o popup de detalhe (antes só `AssetHoverDetails` embutido em `Patrimonio.tsx`) virou componente genérico reutilizável. `groupByKey()` agora carrega `breakdown` (a subdivisão por corretora/ativo dentro de cada bucket agrupado) e `RankedBarList`/`VerticalBarChart` mostram esse detalhe no hover quando o bucket junta mais de uma posição (ex: passar o mouse em "CDB" na Renda Fixa mostra C6/Sofisa/BTG/99/WISE e o valor de cada um). Ver regra em `docs/design-system.md`.
- **Espaçamento**: `marginTop` condicional (`0` quando o bloco anterior não renderiza) trocado por `var(--space-5)` fixo entre todo bloco de gráfico dentro de uma box de tipo de ativo; `.chartLabel` (rótulo do gráfico) ganhou mais vão até o conteúdo (`--space-3` → `--space-4`). Motivo: Luiz apontou que os gráficos estavam "colados" nos títulos/blocos anteriores e cobrou que o design system regesse espaçamento também, não só cor/forma — regra documentada em `design-system.md` pra não regredir.
- **`VerticalBarChart`**: `max` padrão subiu de 12 pra 20 — com 15 ações e 10 FIIs reais, agora mostra todo mundo sem truncar em "Outros" (a barra estreita sozinha via `flex:1`, sobra espaço de sobra pra mais colunas).
- **Nomad em USD**: `PositionSnapshot.fxRateToBRL` (já existia, não era exposto) agora vai na API de `/positions`; a tabela mostra `US$ X` embaixo do `R$ Y` pra toda posição em moeda estrangeira, calculado on-the-fly (`marketValue / fxRateToBRL`) — nunca duplicou o dado em outra escala no banco.
- **"FDIC Insured Deposit"** (a posição de caixa não-investido no extrato Nomad) ganhou `Security.issuer` explicando o que é ("saldo em caixa não investido, protegido pelo seguro federal dos EUA até US$250 mil por banco") — aparece sozinho no hover existente, sem precisar de caso especial na UI.
- **Investigação de cripto (Phantom)**: Luiz reportou BTC "faltando" e um token "token.com" a US$69. Reconsulta on-chain (`getTokenAccountsByOwner`, programa antigo **e** Token-2022) confirmou que a carteira Solana informada só tem SOL + Lux Token — nada mais. BTC não é um ativo Solana (endereço Bitcoin tem formato próprio) — a Phantom é multi-chain e guarda cada rede num endereço separado dentro da mesma carteira. Luiz mandou os 3 endereços que faltavam (Bitcoin, e um endereço EVM usado tanto em Ethereum quanto em Base) — depois de sincronizar de verdade, "token.com" **não era o preço, era o valor total da posição**: 261.734,12 TOKEN na Base ≈ US$69,31 — bate exatamente com o que ele falou.

### Bitcoin + EVM (Ethereum/Base) on-chain (25/08, mesmo dia da investigação acima)

Generalizou o sync on-chain (antes só Solana) pra mais 3 redes, todas só com endereço público:
- `Broker.chain` (novo campo: `solana | bitcoin | ethereum | base`) — 1 broker por rede, mesmo repetindo o endereço quando é EVM (Ethereum e Base usam o mesmo formato de endereço, mas saldo/token são consultados em cada rede separadamente).
- `services/bitcoin.ts` — saldo via Blockstream (API pública, sem chave), preço via CoinGecko.
- `services/evm.ts` — saldo nativo (ETH, inclusive na Base — é o gas token de lá também) via RPC público (`ethereum.publicnode.com` / `mainnet.base.org`); descoberta de token ERC-20 via Blockscout (indexador aberto, sem chave). **Ressalva real**: o Blockscout da Base ficou fora do ar (erro 500) bem na hora de configurar isso — pra não sumir com um holding real só porque o indexador está instável, o sync sempre reconfere direto por RPC (`balanceOf`) qualquer contrato que já apareceu antes num sync anterior daquele broker (`getEvmTokenBalanceDirect`), independente do Blockscout estar de pé. `discoveryFailed: true` no retorno avisa quando a descoberta automática de token NOVO não rodou (não pretende ter certeza de que não tem mais nada).
- `services/onchainSync.ts` — novo orquestrador único: `syncOnchainWallet(brokerId)` lê `broker.chain` e roteia pra Solana/Bitcoin/Ethereum/Base, com o upsert de posição compartilhado entre as 4. `solana.ts` ficou só com as funções de consulta pura (a orquestração saiu de lá).
- Resultado real: Bitcoin 0,00292686 BTC (~R$1.188), Ethereum mainnet zerado (endereço sem uso lá), Base com 0,0004 ETH + **261.734,12 Token.com** (pré-registrado manualmente via `balanceOf` direto na primeira vez, já que o Blockscout da Base estava fora do ar — dali em diante o sync já reconfere sozinho). Cripto total: de R$5,06 pra **R$1.555,66**.

### Auditoria de dado e upload de extrato (25/08, terceira rodada) — 3 bugs reais achados

Luiz pediu pra revisar tudo e sincronizar de novo "sem divergência". Achados reais, não cosméticos:

1. **"Destaques do mês" sempre +0,0%**: comparava por `securityId` entre mês atual e anterior — quebra exatamente no mês em que um broker migra de estimativa manual pra Pluggy (BTG fez isso agora em agosto: `MANUAL:BTG:AÇÕES` → 58 `pluggy:<uuid>` diferentes, zero em comum). As 58 posições reais do BTG sumiam da comparação (sem par no mês anterior), sobrando só CDB estável e Nomad sem atualização — daí o "tudo empatado". Fix: só entra na comparação quem tem snapshot **datado do mês corrente de verdade** (não carregado do mês passado por `activeSnapshotsAsOf`); sem par válido, não aparece como destaque (não inventa 0%). Resultado agora: lista vazia com "Sem histórico suficiente pra comparar" — honesto, vai se popular sozinho a partir de setembro (primeiro mês Pluggy-vs-Pluggy de verdade).
2. **Dashboard e Patrimônio com número diferente pro mesmo dado**: `/api/wealth-overview` agrupava alocação por `security.type` puro; `/api/positions` agrupava por corretora quando `standalone` (regra da Nomad). Resultado: Dashboard mostrava "Renda Fixa R$302k"/"Fundo R$49k" (Nomad espalhada), Patrimônio mostrava R$292k/R$20k (Nomad separada) — total batia, categoria não. Fix: mesmo agrupamento nos dois endpoints.
3. **CDB de liquidez diária de conta digital não sincroniza via Pluggy** — `GET /investments` sempre voltava vazio pra 99 (nunca teve um `pluggy:*`, sempre foi estimativa manual congelada). Causa raiz: a Pluggy não modela isso como Investment — é um campo da própria conta bancária, `GET /accounts` → `bankData.automaticallyInvestedBalance`. 99 estava com R$6.412,99 parado desde julho; valor real agora: **R$2.516,16**. Bônus: o mesmo campo existia pra uma conta específica do BTG (R$326,83) nunca capturada antes. `syncBrokerInvestments` agora busca as duas fontes (`/investments` + `/accounts`) sempre.

**Upload de extrato Nomad**: como a Nomad não tem API (é PDF mensal), a box dela ganhou um botão "Atualizar por extrato" (`components/StatementUploadModal.tsx`). Fluxo em 2 passos, nunca grava direto:
- `POST /brokers/:id/statement-preview` (multipart) — extrai texto do PDF (`pdf-parse`) e roda um parser específico do formato Nomad/Apex Clearing (`services/nomadStatement.ts`, testado contra o extrato real de julho — bate exato: 3 posições + FDIC, soma confere com "Securities Valuation" do próprio documento). Devolve uma prévia, nada é gravado ainda.
- Tela de revisão (editável: tipo do ativo, quantidade, preço, valor) — layout de extrato mudar não corrompe dado, na pior das hipóteses a extração erra um campo e fica visível pra corrigir.
- `POST /brokers/:id/statement-confirm` — grava só depois de revisado. `investedAmount` herda do snapshot anterior (mesma regra do sync on-chain — extrato de posição não traz preço de compra). Câmbio USD/BRL usado é o **do dia de fechamento do extrato** (`getUsdToBrlRateOnDate`, API AwesomeAPI histórica), nunca o de hoje — um extrato de julho não pode ser recotado com dólar de agosto.
- Segurança de re-upload: `Security.id` é `MANUAL:NOMAD:<CUSIP>` (identificador do título, estável entre extratos) em vez de nome — subir o mesmo mês duas vezes atualiza, nunca duplica. As 3 posições que tinham sido gravadas com id por nome (`NVIDIA_BOND` etc.) foram migradas pro esquema novo.

**USD nos totais** (Nomad e Cripto, pedido explícito): `GET /api/fx-rate` novo (cotação atual, só pra exibição) — Cripto usa essa cotação corrente pra mostrar US$ ao lado do R$ em cada posição e no total da box; Nomad usa a taxa já gravada por posição (mais precisa, é a taxa real de quando cada posição foi registrada) tanto por linha quanto no total da box.

### Rentabilidade real via planilha + ajustes de tabela/gráfico (25/08, quarta rodada)

**Causa raiz do "investido = atual" em Ação/FII**: confirmado — a Pluggy não manda `amountOriginal`/`amount` pra investimento tipo EQUITY (só pra Renda Fixa), então o sync caía no fallback `balance` pros dois campos. Sem custo de aquisição real disponível pela API, usamos a planilha "PLANEJAMENTO - PESSOAL.xlsx" (abas `Ações`/`FIIs`, bloco "agosto / 26", coluna "Valor Aplicado") como fonte — é onde o Luiz mantém o controle manual de quanto realmente aportou por ativo.

- **FII**: 9 tickers, todos batem 1:1 por ticker exato (HGLG11, KNRI11, VISC11, MXRF11, HGRE11, XPLG11, KNCR11, ALZR11, HTMX11) — aplicado sem ressalva.
- **Ação**: 12 de 15 posições batem por ticker (PETR4, ITUB4, VALE3, BBSE3, CXSE3, EQTL3, GGBR4, CPFE3, VBBR3, CMIG4, DIRR3 exatos; JBSS32↔JBSS3 da planilha assumido como a mesma JBS, provável mudança de notação de classe — aplicado com essa ressalva). **3 ficaram de fora, propositalmente**: AXIA3 (R$9.325,80) e AXIA7 (R$1.600,53) — a planilha só rastreia uma linha "AXIA6" (outra classe/série do mesmo papel, valor não bate com a soma das duas), e CPLE3 (R$3.599,18) — a planilha rastreia "CPLE6". Ticker com sufixo diferente (3/6/7) é uma classe de ação distinta na B3, não necessariamente a mesma posição — Investido continua igual ao Atual (rentabilidade 0%) até o Luiz confirmar o mapeamento certo.
- **Nomad**: a planilha só rastreia um valor agregado da carteira inteira (aba `INVESTIMENTO26`, bloco "AGOSTO", linha NOMAD: US$7.068,13 investido). Sem detalhamento por bond/ETF, distribuído **proporcionalmente pelo peso atual em USD** de cada uma das 4 posições (ex: o ETF é 73,7% do valor atual, herda 73,7% do investido). Resultado: todas as 4 posições mostram a mesma rentabilidade (8,6%) — é consequência do método (uma única rentabilidade agregada dividida proporcionalmente), não 4 retornos calculados independentemente; fica documentado aqui pra não estranhar depois.
- **Cripto**: a mesma planilha tem uma linha "PHANTOM / CRYPTO" pra agosto (US$2.157,57 investido → US$257,14 atual) que **diverge muito** do valor real verificado on-chain hoje (R$1.559,42 ≈ US$307) — não foi aplicada. Reconstruir custo de aquisição real exigiria minerar o histórico de transações on-chain (data de cada compra/swap, por rede) pra buscar o preço histórico de cada uma via CoinGecko — viável em princípio, mas é um recurso novo (hoje só consultamos saldo atual, não histórico de transação), não construído ainda.

**Coluna "Rentab."** (`components/ReturnBadge.tsx`): mesmo padrão visual do `MonthDelta` (seta colorida indica direção, texto sempre neutro — regra do Design System) — reaproveita `MonthDelta.module.css`. Mostra "—" quando não há investido conhecido (0), nunca uma rentabilidade fingida.

**Tabela de posição**: "Cotas/qtd." e o preço unitário eram uma string só (`52318 × R$ 1,24`) — separados em duas colunas (`Cotas/qtd.` / `Preço unit.`).

**`VerticalBarChart`**: ordem invertida — antes maior à esquerda (ordenação decrescente usada direto pra desenhar), agora menor à esquerda → maior à direita. O destaque (gradiente + pill preto) segue o VALOR, não mais a posição no array, pra continuar marcando o maior onde quer que ele caia depois da inversão.

### Custo real de cripto via histórico on-chain (25/08, quinta rodada)

Luiz deu as datas de compra do Token.com (10, 12, 18, 19/02/2025) e disse que Ethereum e Solana também tiveram compra/venda nesse período. Em vez de pedir os valores de cada uma, mineramos direto da blockchain (mais preciso que depender de memória):

- **Token.com (Base)**: `getTransactionReceipt` + decodificação do log `Transfer` (topic `0xddf252ad...`) do contrato do token, pra cada transação da carteira em fev/2025 (o Blockscout não tinha esse token indexado — 0 resultados no endpoint de token-transfers — então fomos direto no RPC). Achamos **6 compras** (não 4 — 10/02 e 12/02 tiveram 2 cada), somando exatamente **261.734,12 TOKEN — bate com o saldo atual até a casa decimal**, confirmando que nunca vendeu nada dessa posição. Custo: 5 das 6 pernas exatas via USDC on-chain, 1 estimada pelo preço implícito da compra do mesmo dia (~3h de diferença). Convertido pra BRL usando a cotação USD/BRL **do dia de cada compra** (`getUsdToBrlRateOnDate`, já existia pro upload de extrato), não uma taxa única. Total investido: **R$11.206,05** (vs. R$356,83 hoje — rentabilidade real: **-96,8%**, uma queda de preço real de ~$0,0075→$0,00026 por token).
- **Solana**: histórico da carteira inteiro (32 transações) também 100% confinado a fev/2025, batendo com o que o Luiz falou. Achamos a compra de Lux Token, mas a segunda perna (a maior, +25.992 LUX) não teve uma variação de SOL nativo compatível com o valor — provavelmente passou por uma conta de SOL "wrapped" (WSOL) que não é capturada pela leitura simples de saldo nativo que fizemos. Como a posição vale R$3,32 hoje, não valeu o esforço de rastrear a rota completa — investedAmount ficou como estava (valor de mercado do primeiro sync).
- **Ethereum (mainnet)**: sem posição ativa hoje (saldo 0, confirmado antes) — não há o que aplicar custo, mesmo com compra/venda no passado; seria um dado de "posição encerrada", não uma tabela que a Patrimônio mostra hoje.
- **Bitcoin**: Luiz não deu data de compra — investedAmount continua como estava (herdado do primeiro sync), rentabilidade 0% até ele confirmar quando comprou.

**Bug real achado no meio do caminho**: um rate limit do CoinGecko durante um sync anterior fez `getTokenInfo`/`getEvmTokenInfo` caírem no fallback (nome = endereço do contrato cru) — e como o `security.upsert` sempre sobrescrevia `name`/`ticker` no `update`, isso **gravou permanentemente** o endereço como nome do Lux Token, mesmo depois do CoinGecko voltar ao ar (o sync seguinte não tinha motivo pra corrigir um nome que "já existia"). Corrigido: `getTokenInfo`/`getEvmTokenInfo` agora retornam `null` (não mais o endereço) quando a CoinGecko falha, e `onchainSync.ts` só inclui `name`/`ticker` no `update` quando não é null — nunca mais sobrescreve um nome bom com um fallback ruim.

### Evolução por grupo, não por corretora (25/08, sexta rodada) — 2 bugs reais

Luiz reportou "gráfico de evolução vindo com valor errado" em FII/Ação/Nomad, cripto misturando corretoras que não existem, gráfico "por ativo" só em barra vertical em alguns lugares, e Renda Fixa sem evolução. Investigado: **causa raiz única** pros 3 primeiros pontos.

- **Bug real**: `/api/positions/history?broker=X` somava TODAS as posições daquela corretora, não só as do tipo mostrado na caixa. BTG está em Renda Fixa+FII+Ação+Fundo — a caixa "Ação" (que vale R$76 mil) mostrava a evolução do **BTG inteiro** (~R$430 mil). Rota reescrita pra `?group=X`, usando o **mesmo agrupamento do `/api/positions`** (`broker.standalone ? broker.name : security.type`) — a evolução de cada caixa agora é exatamente do que ela mostra, nunca mais nem menos.
- Isso também tirou a exigência de "corretora única" pra mostrar Evolução (fazia sentido quando o histórico era por corretora; não faz mais). Resultado: **Renda Fixa e Cripto ganharam Evolução de graça** — Renda Fixa agrega BTG+C6+Sofisa+WISE+99 num histórico só; Cripto agrega PHANTOM+PHANTOM_BTC+PHANTOM_ETH+PHANTOM_BASE.
- **Segundo bug real, achado testando o primeiro**: a evolução da Nomad tinha um mês (julho) com o **dobro** do valor certo. Causa: a posição agregada antiga `MANUAL:NOMAD:USD` (substituída pelas 4 posições reais do extrato PDF a partir de julho) ainda tinha um snapshot de maio/2026 no banco — dentro da janela de carência de 2 meses (`ACTIVE_WINDOW_MONTHS`), esse snapshot "carregava" até julho e se somava por cima dos dados novos e reais. Removido o snapshot de maio (era o único remanescente causando conflito; jan/2025-abr/2026 continuam intactos e corretos pros meses que não têm dado novo pra conflitar).
- **Cripto "por corretora" removido**: PHANTOM/PHANTOM_BTC/PHANTOM_ETH/PHANTOM_BASE são a mesma carteira dividida por rede (decisão nossa de modelagem, não corretoras reais como BTG/C6) — mostrar isso como "por corretora" confundia. `HIDE_BROKER_BREAKDOWN_TYPES = new Set(['Cripto'])` esconde esse gráfico só pra Cripto; Renda Fixa continua mostrando (BTG/C6/Sofisa/WISE/99 são corretoras de verdade).
- **"Por ativo" unificado**: todo tipo agora usa `VerticalBarChart` (antes só Ação/FII; Renda Fixa/Nomad/Cripto usavam `RankedBarList` horizontal). Consistência visual em todas as caixas; `RankedBarList` continua existindo como componente (não deletado), só não é mais usado aqui.

### INCO — empréstimo P2P a empreendimentos, um por posição (25/08)

Luiz empresta dinheiro a empreendimentos (CCB/Debênture/CRI/participação) via plataforma INCO, com taxa contratada e pagamento em parcelas amortizadas ou juros mensais. A INCO já existia como `Broker` (histórico até nov/2025, linha agregada "ATIVOS") — sem schema novo, só passou a rastrear **uma posição por empreendimento** (mesmo padrão de granularidade de CDB/Tesouro), a pedido do Luiz depois de mandar print de 7 posições reais da plataforma.

- **Mapeamento de campo**: `investedAmount` = valor originalmente investido **menos valor já amortizado** (principal ainda em aberto) — não o valor investido original fixo. Motivo: num empréstimo que amortiza, parte do principal já volta pro bolso do Luiz mês a mês; comparar o valor atual contra o principal ORIGINAL (já parcialmente devolvido) mostraria uma "perda" que não existe (caso real: Fica Empreendimentos, R$5.000 investido menos R$1.427,92 já amortizado = R$3.572,08 em aberto vs. R$4.667,53 atual — rentabilidade real +30,7%, não -6,6% como daria com o principal cheio). `marketValue` = "Valor ativo bruto" que a própria plataforma informa.
- **Taxa flutuante** (`CDI + 6% a.a.`, `IPCA + 10,84% a.a.`): não existe campo fixo pra isso (CDB via Pluggy é sempre taxa numérica fixa). `assetHoverContent` em `Patrimonio.tsx` agora mostra `ratePeriodicity` sozinho como a taxa contratada quando `fixedAnnualRate` é null — guarda a descrição inteira ali em vez de forçar um número. ICARUS (Lynch Capital 3) é exceção real: taxa é fixa mesmo (`19% a.a.`, sem CDI/IPCA), guardada como `fixedAnnualRate` normal.
- **"INCO - Equity HGIB"** é diferente das outras 6 (não é empréstimo — é participação societária/contrato de equity na própria INCO, retorno variável, prazo indeterminado) — classificado como tipo `Fundo`, não `Renda Fixa`.
- **`dividends` (juros do mês) ficou null nessa entrada inicial** — a plataforma só expõe "Lucro líquido"/"Total recebido" **acumulado desde o início** de cada posição, não quebrado por mês. Gravar isso como se fosse renda de um mês só infla "Proventos previstos" artificialmente. A partir do próximo mês, `dividends` passa a ser preenchido com o INCREMENTO real (lucro líquido deste mês menos o do mês anterior).
- **Risco real observado, não travado no dado**: ICARUS (Lynch Capital 3) está com a parcela **em atraso** — sinalizado ao Luiz na conversa, sem campo novo no schema pra status de inadimplência (seria over-engineering pra um caso só; revisitar se acontecer de novo).

### INCO vira box própria (25/08, mesmo dia)

`Broker.standalone = true` pra INCO — mesmo mecanismo já existente pra Nomad, zero código novo. Resultado automático: as 7 posições (6 empréstimos + a participação Equity HGIB) saem de espalhadas entre Renda Fixa/Fundo e viram uma box só "INCO" (R$35.484,24), com Evolução e "Por ativo" em barra vertical (por empreendimento) aparecendo de graça — é a mesma lógica que já roda pra qualquer grupo.

Único ajuste de código necessário: o botão "Atualizar por extrato" (upload de PDF) estava condicionado a `dataSource === 'manual_statement'`, que também é o caso da INCO — mas o parser (`parseNomadStatement`) é específico do formato Nomad/Apex Clearing. Restrito pra `broker.name === 'NOMAD'` explicitamente, não genérico por dataSource.

### Orçamento com dado real (29/08) — categorias, metas e 1109 transações

Luiz mandou a planilha real "ORÇAMENTO - PESSOAL - 2026" (Google Sheets, acessada via Chrome autenticado — a exportação anônima por URL dá 401, é privada). 3 abas relevantes: `Orçamento` (meta mensal Projetado/Realizado por categoria), `Gastos Diários` (total gasto por dia, calendário), `Entradas e Saídas` (livro-razão real, 1904 linhas).

- **Categorias recriadas do zero**: as 40 categorias antigas eram um rascunho (tudo `essential: false`, nomes que não batiam com o uso real). Substituídas por 47 categorias reais, extraídas direto do livro-razão (`Entradas e Saídas`, coluna "Categoria") — 7 receita, 35 despesa (12 essenciais/23 não-essenciais, conferido contra a seção "Despesas essenciais" da aba Orçamento, que usa os **mesmos nomes exatos**) + 5 categorias de investimento (Reserva de Emergência, Fundo Imobiliário, Nomad, Ações, Liberdade Financeira — seção própria na planilha, separada de "Despesas", sem transação real ainda).
- **1109 transações reais importadas** (`source: "spreadsheet_import"`) — todas as linhas do livro-razão com data até hoje (29/08/2026). Conferido contra o "Realizado" que a própria aba Orçamento já calculava (ex: Supermercado de agosto bateu R$803,48 nos dois lugares, de forma independente).
- **95 linhas com data futura não foram importadas como Transaction** — são parcela de compra parcelada ainda a vencer (ex: "monitor Dell" 12x, uma parcela por mês até dezembro), não fato consumado. Salvas em `tmp-import/future-installments.json` pra alimentar depois a visão de "quanto ainda tenho comprometido no cartão".
- **Parcelamento**: a própria planilha já codifica isso na descrição (`"tenis nike x2"` … `"x7"` = parcela 2 de uma sequência) — 389 das 1204 linhas têm esse padrão, 63 compras parceladas distintas. Reaproveitado na importação: `"tenis nike x2"` vira `"tenis nike (parcela 2)"` na descrição da Transaction.
- **`BudgetTarget` real**: 368 linhas (46 categorias × jan-ago/2026, usando a coluna "Projetado" da aba Orçamento) — meses futuros (set-dez) não foram importados, pra não fixar meta em cima de projeção de fórmula ainda não decidida por ele.
- **Bug corrigido no import**: valor negativo formatado `"-R$ 51,648.35"` (categoria "Liberdade Financeira") quebrava o parser ingênuo (`.replace("R$","")` deixava espaço entre o `-` e o número, virava `NaN`) — corrigido pra extrair só dígitos/ponto/vírgula/sinal via regex antes de converter.
- **Acesso à planilha**: export anônimo por URL (`/export?format=xlsx`) retorna 401 pra planilha privada — funcionou navegando pelo Chrome autenticado do Luiz (`claude-in-chrome`) e baixando de lá. Download caiu em `~/Downloads`, que o Bash não consegue ler (Full Disk Access do terminal não cobre isso — só `request_directory`/`change_directory`, que dão acesso a Read/Write/Edit mas não a Bash); resolvido pedindo pro Luiz copiar o arquivo pra `tmp-import/` manualmente.

### Página `/orcamento` sai do placeholder (29/08, mesmo dia)

Primeira versão real da página, sobre o dado importado acima. Endpoints novos:

- **`PUT /api/budget-target`** — upsert de meta por categoria/mês (não existia; só dava pra ler). É o "no primeiro dia do mês eu estipulo o que posso gastar" do Luiz — editável inline na própria lista de categoria (lápis → campo → confirmar), sem tela separada.
- **`POST /api/budget-target/copy-from-previous-month`** — copia meta do mês anterior pras categorias que ainda não têm meta no mês novo (nunca sobrescreve o que ele já ajustou manualmente nesse mês).
- **`GET /api/credit-cards`** — fatura/limite de cada cartão de crédito conectado via Pluggy (usado, limite, disponível, vencimento, pagamento mínimo), direto de `GET /accounts` da Pluggy — sem snapshot histórico, é sempre a foto de agora. Achado real ao testar: **cartão BTG BLACK usado R$57.629 de R$58.400 (só R$770 livre)**.
- **`GET /api/upcoming-installments`** — as 95 parcelas futuras importadas acima, agora num model próprio `UpcomingInstallment` (migração nova, não é `Transaction` — não aconteceu ainda). Total comprometido: R$50.761,02.
- `budget-summary`: `categories[]` agora só traz categoria de despesa (antes misturava categoria de receita tipo "Salário", que não faz sentido numa lista de "gasto vs. meta") — e ganhou o campo `kind` (ver abaixo), usado pra separar a lista em seções na tela.

Layout da página: total do mês → gasto diário (com forma de setar meta diária nova, hoje só existia em Configurações) → cartões de crédito → parcelas futuras (por mês + tabela) → categorias por `kind` (cada uma editável inline).

**Ainda não construído** (próximo passo natural): sync de transação da Pluggy pro C6 (cartão, 378 transações reais confirmadas) e 99 (conta, 145) — hoje o dado é só o histórico importado da planilha (até 29/08); sem esse sync, a partir de amanhã a página para de receber gasto novo sozinha.

### Redesign do "Total do mês" + revisão de orçamento + `Category.kind` (29/08, mesmo dia)

Luiz pediu 3 coisas depois de ver a primeira versão:

1. **"Total do mês" vira gráfico de pizza** ("mostrando onde estou gastando"), não mais barra de progresso — e categoria sem gasto nenhum não vira fatia (fatia de R$0 não ajuda, só polui). `ClientPieChart` reaproveitado do Patrimônio, `data = categories.filter(c => c.spent > 0)`.
2. **Modal de revisão passo a passo** (`components/BudgetReviewModal.tsx`) — em vez de editar tudo inline de uma vez, uma categoria por tela, mostrando **o gasto real do mês anterior** já pré-preenchido no campo (o pedido literal: "gastei 600 de terapia mês passado, posso ou não continuar com esse orçamento"). Endpoint novo `GET /budget-target/review?month&year` — diferente do `/budget-summary`, traz **toda** categoria de despesa mesmo sem meta ainda no mês (é exatamente o caso de mês novo, começando do zero). Banner automático sugerindo revisar quando é começo de mês (dia ≤ 5) e o mês corrente ainda não tem nenhuma meta setada.
3. **`Category.essential` (booleano) virou `Category.kind` (string: `essential | non_essential | investment`)** — o boolean só dava pra separar 2 grupos, mas a estrutura real do Luiz tem 3 (as 5 categorias de investimento + "Empréstimo Concedido" formam uma seção própria, separada de "despesa" de verdade). Migração recria a tabela `Category` (SQLite não faz `ALTER COLUMN` de tipo).

**Correções de categoria** feitas junto (pedido explícito "melhorar as categorias"):
- 3 erros de digitação: "Cirugia Estética" → Cirurgia, "Fundo Imobialrio" → Imobiliário, "Açoes" → Ações.
- **"Emprestimo" renomeada pra "Empréstimo Concedido"** — não é dívida do Luiz, é dinheiro que ele emprestou pra outra pessoa (confirmado por ele). As 2 transações reais dessa categoria (R$9.000 "deposito caucao" + R$50.000 "emprestimos tio joao") foram marcadas `isTransfer: true` — antes contavam como gasto normal e infriam a "Despesas Totais" do mês em R$59 mil de forma incorreta (empréstimo concedido não é gasto, é o dinheiro saindo do caixa mas continuando "seu", só em outro lugar — mesma lógica de transferência já usada pra fatura de cartão).
- Terapia e "Compras - Internet" vs "Compras - Shopping" foram perguntados e confirmados como já estavam (Terapia continua não-essencial — "posso parar a terapia"; Internet = compra online, Shopping = loja física).

**Erro cometido e corrigido no meio do caminho**: rodei `prisma db push --accept-data-loss` pra aplicar o schema antes de escrever a migração formal — isso já apagou a coluna `essential` (virou `kind` com o valor padrão pra tudo) antes da migração manual (que faria o mapeamento certo `essential=true → kind='essential'`) rodar de fato. Resultado: as 12 categorias essenciais ficaram classificadas como `non_essential` por um instante. Corrigido reaplicando a classificação certa direto (`UPDATE ... WHERE name IN (...)`) — a migração `.sql` gravada no repo está correta pra quem rodar `migrate deploy` num banco novo (que ainda tem `essential` populado de verdade), só não foi o que rodou nesse dev.db específico.

**Acesso ao disco caiu de novo no meio do trabalho** — mesmo sintoma documentado antes (Full Disk Access do terminal), dessa vez precisou fechar o app do terminal por completo (não bastava só re-conceder a permissão) pra voltar a funcionar.

### 6 ajustes de fatura real, revisão em lista e correções (29/08, mesmo dia)

Luiz mandou print da fatura real da Caixa (2 cartões, "5709" e "2220") e do app do C6 (parcelas dos cartões virtuais), pra bater contra o que já estava importado da planilha, mais 5 pedidos de ajuste na página. Nessa ordem:

1. **Parcelamento da Caixa importado da fatura real**, não só da planilha — a planilha só tinha parcela até dezembro/2026 (Luiz parou de preencher lá), a fatura mostra o parcelamento completo até jul/2027. Novo campo `UpcomingInstallment.cardLabel` (migração `20260829220000_installment_card_label`, `ADD COLUMN` simples — sem recriar tabela) grava a qual cartão cada parcela pertence. 33 compras reais transcritas das duas faturas (26 no cartão 5709, 7 no 2220) viraram 100 parcelas futuras (84 + 16), a partir da fração "X DE Y" que a própria fatura mostra pra cada compra (conferido contra a data de hoje: uma compra de nov/2025 mostrando "9 DE 12" bate certinho com 9 meses cobrados até ago/2026). BTG não precisou de import manual — o único parcelamento de lá (Usina Solar) já vem via Pluggy.
   - **Risco não resolvido**: 5 duplicatas entre planilha e fatura foram achadas e removidas por **coincidência exata de valor** (ex: "aparador x3/x4/x5/x6" da planilha = "TOKSTOK tokstok 6441839" da fatura, mesmo valor R$239,90 em sequência de 4 meses — claramente a mesma compra registrada duas vezes, sob nomes diferentes). Esse método só pega duplicata que bate o centavo — pode haver outras entre as ~91 linhas "sem cartão" restantes (vindas só da planilha) que a Caixa também já tem na fatura, com valor levemente diferente (arredondamento) ou por só não ter sido comparada. Não dá pra confirmar sem outra rodada de conferência manual.
2. **Modal de revisão de orçamento deixou de ser passo a passo** — Luiz achou lento conferir categoria por categoria. `BudgetReviewModal.tsx` reescrito: lista única (tabela) com toda categoria de uma vez, valor do mês passado ao lado de um campo editável já pré-preenchido, um botão "Salvar N categorias" no fim. Mesmo endpoint (`GET /budget-target/review`), só mudou a UI.
3. **"Salvar meta diária" duplicado removido do Orçamento** — Luiz notou que já existe em Configurações → "Meta diária de gasto" (com histórico completo). O card "Gasto diário" da página Orçamento tinha seu próprio formulário chamando o mesmo `POST /daily-goal`, sem histórico — duplicação sem necessidade. Trocado por um link "Editar meta em Configurações" no cabeçalho do card; a página continua mostrando o valor vigente e o progresso do dia, só não deixa mais editar ali.
4. **Cartão da Caixa aparece em "Cartões de crédito"** mesmo sem conector na Pluggy (Luiz não usa mais esse cartão, mas ainda paga fatura dos parcelamentos em andamento). `GET /credit-cards` ganhou uma lista `MANUAL_CARDS = ["Caixa 5709", "Caixa 2220"]` — pra cada um, soma as `UpcomingInstallment` já importadas no passo 1 (nunca um valor digitado à mão) e mostra como "usado", sem limite/disponível/vencimento (informação que só a Pluggy teria). Front trata `creditLimit: null` mostrando um aviso no lugar da barra de progresso, em vez de quebrar ou mostrar 0%.
5. **"Comprometido em parcelas futuras" ganhou quebra por cartão** — antes só total geral e por mês. `GET /upcoming-installments` agora retorna `byCard` (soma por `cardLabel`, "Outros (sem cartão identificado)" pras linhas vindas só da planilha) — Luiz pediu explicitamente pra "sintetizar o que teremos em todos os cartões". Combinado com o passo 1: hoje mostra R$64.879,38 comprometidos em 190 parcelas, indo até jul/2027. **Combinado com o pedido dele de não usar mais Caixa daqui pra frente**: essa importação da Caixa é histórica/pontual (não vai ter sync contínuo); quando o sync real de transação da Pluggy for construído pro C6 e BTG (próximo passo, ainda não feito), essas duas contas passam a alimentar `UpcomingInstallment` sozinhas — Caixa fica só com o que já foi importado hoje.
6. **"Empréstimo Concedido" corrigido de `investment` pra `non_essential`** — Luiz esclareceu que não é investimento (dinheiro que ele pode ou não receber de volta), é diferente de aportar num ativo. `Category.kind` dessa categoria específica atualizado no banco (`UPDATE Category SET kind='non_essential' WHERE name='Empréstimo Concedido'`).

### 5 ajustes finos pós-fatura (29/08, mesmo dia)

Luiz revisou a versão anterior e pediu mais 5 ajustes, direto:

1. **Caixa 5709 e 2220 viram um cartão só ("Caixa")** — ele confirmou que na prática é o mesmo cartão físico (provavelmente um virtual pro mesmo real). `UPDATE UpcomingInstallment SET cardLabel='Caixa' WHERE cardLabel IN ('Caixa 5709','Caixa 2220')`, `MANUAL_CARDS` em `brokers.ts` passa a ter só `["Caixa"]`. Total consolidado: R$15.128,79 em 100 parcelas.
2. **Aluguel removido de "compra parcelada"** — o import original da planilha detectava qualquer `"nome xN"` como parcela de compra, e pegou "Aluguel x8/x9/x10/x11" (Luiz simplesmente numerava os meses de pagamento na planilha, não é uma compra que termina). Eram 4 linhas, R$4.535,65 cada, removidas (`DELETE FROM UpcomingInstallment WHERE description LIKE 'Aluguel x%'`). **Mesmo padrão encontrado em "academi korpus x8..x11"** (mensalidade da academia) — não removido ainda, fica pra próxima rodada de conferência com o Luiz (mesmo risco: mensalidade fixa sendo tratada como parcelamento com fim).
3. **Parcelas futuras e cartão manual agora acompanham o mês navegado** — antes `GET /upcoming-installments` e o cartão manual da Caixa em `GET /credit-cards` somavam TUDO pra sempre, nunca diminuindo. Os dois endpoints ganharam `?month&year` (mesmo mês que o Luiz está navegando no Orçamento) e filtram `dueDate >= início do mês`; avançar mês agora esvazia o que já venceu — verificado que o "usado" do cartão Caixa cai de R$15.128,79 (ago/2026) pra R$5.468,80 (dez/2026) pra R$289,74 (jun/2027) até sumir da lista em ago/2027, quando o último parcelamento termina. Botão **"Hoje"** novo ao lado da navegação de mês, só aparece quando não está no mês atual — atalho pra voltar rápido sem clicar em "‹" várias vezes.
4. **Categorias (essencial/não-essencial/investimento) lado a lado, sem editar inline** — os 3 boxes eram empilhados um embaixo do outro; agora ficam em 3 colunas (grid, empilha em 1 coluna no mobile). O lápis de edição por categoria foi removido — a edição de meta é só pelo modal "Revisar orçamento" agora (existiam dois jeitos de editar a mesma coisa, sem necessidade).
5. **Pedido em aberto**: Luiz vai indicar quais das 82 parcelas futuras "sem cartão identificado" (R$16.219,07, vindas só da planilha, sem saber se é Caixa ou C6) pertencem a qual cartão real, pra corrigir e manter automático dali pra frente. Levantamento feito e entregue a ele — destaque: **"monitor Dell" (planilha, R$506,58, 4 parcelas) é quase certamente a mesma compra "DELL" já importada da fatura da Caixa (R$506,62, parcela 7 de 12)** — diferença de 4 centavos (arredondamento), não pegou no filtro de duplicata por valor exato da rodada anterior. Photo/lista completa das ~30 compras "sem cartão" fica no histórico da conversa, não replicada aqui pra não duplicar manutenção.

### Ponto 5 resolvido (29/08, mesmo dia): Luiz bateu as compras "sem cartão" com os cartões reais

Confirmação item por item, cruzada contra os dados já importados da fatura da Caixa (comparação por comerciante + valor):

- **7 duplicatas confirmadas e removidas** (a mesma compra já existia, vinda da fatura real da Caixa, sob outro nome/valor com centavos de diferença por arredondamento) — `monitor Dell` (R$506,58 × 4) = `DELL`; `tv 65` (R$591,30 × 3) = `MERCADOLIVRE MERCADOLI`; `toca disco` (R$144,83 × 4) = `AMAZONMKTPLC UPTECHDOB`; `vans` (R$145,00 × 3) = `VANS LAPI`; `soundbar` (R$165,58 × 2) = `KABUM`; `ferreira costa` (R$89,03 × 3) = `FERREIRA COSTA`; `item pra casa` (R$86,99 × 4) = `AMAZONMKTPLC VRNEMPRES`. Total removido: R$5.760,75 em 23 linhas.
- **4 compras rotuladas como C6** (não estavam na fatura da Caixa, são parcelamento genuíno do C6 — ainda sem sync automático da Pluggy, então ficam manuais por enquanto): `bike` → People Bike Shop (R$1.159,00 × 4), `tramontina` → 77TRAMO*LOJA (R$237,53 × 3), `nutricao` → LA ODONTOLOGIA INTEGRA (R$230,00 × 1), `estilhaços` → MP*Estilhacoesdicos (R$110,00 × 1). Total: R$5.688,59 em 9 linhas.
- **`tokstok` (R$387,79 × 3) segue sem cartão** — Luiz não confirmou de qual é, fica pendente.
- Resultado: "sem cartão identificado" caiu de R$16.219,07 pra **R$4.769,73** (50 linhas restantes, incluindo o tokstok pendente e outras ~25 compras menores ainda não conferidas).

### C6 mostrava R$0,00 gasto no cartão — gap real da Pluggy, não bug nosso (29/08, mesmo dia)

Luiz notou que "Cartões de crédito" mostrava R$0,00 usado no C6, mesmo ele usando o cartão ativamente. Investigado direto na API da Pluggy (não é suposição): a resposta bruta de `GET /accounts` pro C6 traz `balance: 0` e `disaggregatedCreditLimits[].usedAmount: 0` — só que `creditLimit: 101.400` e `availableCreditLimit: 66.901,51` ao mesmo tempo, o que só faz sentido se ~R$34.498,49 estiver em uso. É um gap conhecido de Open Finance: nem toda instituição preenche o campo "saldo usado" do cartão em tempo real, mas limite e disponível continuam confiáveis.

**Corrigido** calculando `usedAmount = creditLimit - availableCreditLimit` em vez de usar `balance` direto — os dois batem exatamente pro BTG (57.629,38 = 58.400 - 770,62, o valor não muda), e resolve o C6 (34.498,49, antes aparecia como 0). Não é valor inventado: os dois números usados na subtração (`creditLimit`, `availableCreditLimit`) vêm direto da Pluggy, só o `balance` que não é confiável nesse conector.

### Box "Investimento" fora do Orçamento (30/08)

Luiz pediu pra tirar a seção "Investimento" da página. Não foi só esconder no front — o `/budget-summary` e o `/budget-target/review` passaram a excluir `kind: "investment"` na consulta (`category: { type: "expense", kind: { not: "investment" } }`), porque a meta de investimento (ex: R$1.323,05 de "Liberdade Financeira") estava inflando o "planejado" do topo da página junto com despesa de verdade — não fazia sentido somar aporte com gasto no mesmo total. `totalPlanned` de agosto caiu de R$19.500 pra R$18.176,95 (só despesa essencial + não essencial). As 5 categorias de investimento continuam existindo no banco — só não aparecem mais em Orçamento, o lugar delas é Patrimônio.

### Confirmado: a Pluggy já entrega parcelamento do C6 em tempo real (30/08)

Luiz perguntou se dá pra saber quando uma compra parcelada acontece no cartão do C6. Resposta: **sim, já está lá** — puxei ao vivo `GET /v2/transactions` da conta de crédito do C6 e achei uma compra real e recente ("BRUNO DALTRO PAPEL MAC RECIFE", R$125,00, 27/08/2026) com `creditCardMetadata: { totalInstallments: 2, installmentNumber: 1 }`. Ou seja, a Pluggy já manda `installmentNumber`/`totalInstallments` por transação quando é parcelado — dá pra automatizar 100% (gerar as parcelas futuras restantes a partir de `billForecastDate` + `totalInstallments - installmentNumber`), sem precisar de import manual de fatura como fizemos pra Caixa. Ainda não implementado — é o sync real de transação da Pluggy pro C6/BTG que já estava anotado como próximo passo; agora com confirmação concreta de que o dado existe e o formato exato dele.

### Correção: BTG/C6/99/Sofisa NÃO são dado fake — é "Meu Pluggy" de propósito (30/08)

Luiz perguntou por que BTG e C6 não atualizam quando ele navega o mês em Orçamento. Investigando, achei que os 4 brokers Pluggy (BTG, C6, 99, Sofisa) passam pelo mesmo conector **"MeuPluggy"** (`meu.pluggy.ai`, `credentials: []`, ícone `sandbox.svg`) e cheguei a alarmar o Luiz achando que fosse dado de demonstração/sandbox da Pluggy, violando "nada de valores fakes". **Estava errado** — Luiz esclareceu: ele mesmo criou uma conta no Meu Pluggy (produto real da própria Pluggy) e conectou lá os bancos de verdade (BTG, C6, 99, Sofisa) via Open Finance real. O Financial Hub não precisa da própria certificação/plano pago de Open Finance porque **o Meu Pluggy já fez essa parte** — a API pessoal (plano gratuito) só lê o resultado já sincronizado. Os sinais que me confundiram (zero credenciais, nome genérico, ícone "sandbox") são consequência de a autenticação real já ter acontecido dentro do Meu Pluggy, não evidência de dado falso. Fica documentado aqui pra não repetir esse alarme por engano numa sessão futura.

**Resposta real da pergunta original** (por que BTG/C6 não seguem o mês navegado): `GET /accounts` da Pluggy devolve sempre o saldo/limite **atual** do cartão — não existe endpoint de "saldo como estava em outubro". Só o cartão manual da Caixa (e o C6/BTG quando o sync de transação for construído) consegue variar por mês, porque aí a data de vencimento de cada parcela é nossa, gravada localmente. Adicionado um aviso "saldo atual da Pluggy — não muda ao navegar mês" embaixo de cada cartão Pluggy pra deixar isso explícito na tela.

**Sobre forçar atualização**: testei `PATCH /items/{id}` (o endpoint da Pluggy pra pedir resync agora) contra o C6 e ele rejeita: `"MeuPluggy item cant be updated"` — esse tipo de conector não aceita gatilho de sync via API (não é limite de plano, é do tipo de conector). Ou seja, não dá pra forçar a Pluggy a checar o banco de novo por aqui — isso só acontece pelo lado do Meu Pluggy (agenda própria dele, ou abrindo o app/site e deixando ele resincronizar). O que O Financial Hub já faz: toda chamada (`GET /accounts`, `/investments` etc.) já é ao vivo, sem cache — carregar a página sempre mostra o que a Pluggy tem sincronizado até agora. Adicionado um botão "Atualizar" no header (`AppLayout.tsx`, ícone ao lado de busca/notificações) que recarrega a página inteira — não força a Pluggy a resincronizar (confirmado que essa API não permite), mas garante que tudo que está na tela busca de novo, num clique só, sem precisar navegar entre páginas.

**Delay medido de verdade (01/09)**: a transação mais recente que a Pluggy tinha do C6, no dia em que rodamos o sync de transação (ver "Sync real de transação de cartão de crédito" abaixo), era de 27/08 — **~4 dias de atraso** entre a compra acontecer e ela ficar disponível pra puxar por aqui. Confirma na prática a limitação documentada acima: não tem nada no nosso app que reduza isso, só o Meu Pluggy resincronizando por conta própria (ou, se existir, algum "atualizar agora" dentro do próprio app/site do Meu Pluggy — não testado, é fora do nosso sistema).

**Confirmado na documentação oficial (01/09)** — não é bug nem atraso do Meu Pluggy, é comportamento padrão documentado:
- Pluggy ([Data sync: Update an Item](https://docs.pluggy.ai/docs/data-sync-update-an-item)): cada sync usa uma "lookback window" — conector direto = **4 a 5 dias corridos** desde a última sync (bate exatamente com o que medimos), conector Open Finance regulado = 7 dias. Sync automático roda **1x por dia** sozinho, sem gatilho manual.
- Open Finance Brasil em geral: transação nova pode levar de horas até ~5 dias pra ficar disponível — e essa parte é responsabilidade da **instituição financeira** (o banco), não do agregador. Fonte: [Latência na Disponibilização de Dados Open Finance — Tecnospeed](https://atendimento.tecnospeed.com.br/hc/pt-br/articles/35987450931863-Lat%C3%AAncia-na-Disponibiliza%C3%A7%C3%A3o-de-Dados-Open-Finance).

### Ferramenta de revisão de parcelas + cartões Pluggy ganham quebra month-aware (30/08)

Luiz pediu uma interface pra conferir e corrigir as parcelas futuras de uma vez (dropdown de cartão + campo de valor por compra), em vez de eu ficar corrigindo uma por uma via chat. Construído:

- **`GET /api/upcoming-installments/groups`** — agrupa TODAS as parcelas (sem filtro de mês, é ferramenta de auditoria) por compra: mesma descrição-base (tira o sufixo " xN" que a planilha usa) + mesmo valor = mesma compra, uma linha por mês restante. Devolve `ids[]` de cada grupo (pra editar todas as parcelas da mesma compra de uma vez, não uma por uma) e `knownCards` (BTG/C6/Caixa, dinâmico — não hardcoded). Ordena sem-cartão primeiro.
- **`PUT /api/upcoming-installments/group`** (atualiza cardLabel e/ou amount de todo o grupo) e **`DELETE /api/upcoming-installments/group`** (remove o grupo inteiro — pra duplicata confirmada).
- **`InstallmentReviewModal.tsx`** — tabela com todas as compras, dropdown de cartão (BTG/C6/Caixa/"Outro..." com campo livre) + campo de valor editável + Salvar/Excluir por linha. Aberta via botão "Revisar parcelas" no card "Comprometido em parcelas futuras". Hoje: 19 compras sem cartão, 35 já configuradas.

Luiz também notou que, já que temos as parcelas de BTG/C6 rotuladas (`cardLabel`), dá pra saber "quanto vai cair em setembro" nesses cartões também, não só na Caixa. Isso já existia parcialmente na seção "por cartão" de parcelas futuras (que já filtra por mês) — o que faltava era mostrar no PRÓPRIO card do cartão. Adicionado `trackedInstallments` em `GET /credit-cards`: soma das `UpcomingInstallment` daquele cartão a partir do mês navegado — aparece como uma linha extra nos cards Pluggy (BTG/C6): "R$X em parcelas já identificadas a partir de [mês]", **claramente marcado como parcial** (nem toda compra desses cartões foi conferida ainda — só R$5.688,59 de R$34.498,49 usados no C6, por exemplo). Não substitui o `usedAmount` (saldo real da Pluggy, que não varia por mês) — é um número complementar, e SÓ ele varia com a navegação de mês.

### Cartões de crédito padronizados + Usina Solar completa (30/08)

Luiz achou o card "Cartões de crédito" confuso (BTG/C6 com formato diferente de Caixa, textos "sem Pluggy", "saldo atual da Pluggy" e a linha "parcelas já identificadas" que ninguém pediu de fato). Simplificado pra um formato único nos 3 cartões: **usado / de [limite] / [disponível] livre** + barra de progresso — sem texto extra. Removido `trackedInstallments` inteiro (era mais confuso que útil).

Isso só foi possível pro Caixa porque **Luiz informou o limite real: R$58.000** (esse cartão não está na Pluggy, então não tinha como saber isso sozinho) — gravado em `MANUAL_CARD_LIMITS` (`brokers.ts`), citado explicitamente como vindo dele, não inferido. `availableLimit` do Caixa agora é `58.000 - usado`, igual ao cálculo dos cartões Pluggy.

**Usina Solar completada**: Luiz confirmou que o parcelamento real é de **24x**, mas só tínhamos cadastrado até a parcela 10 (a planilha dele também só ia até lá). Adicionadas as parcelas 11 a 24 (jan/2027 a fev/2028, mesmo valor R$3.847,23), rodando `tmp-import/extend-usina-solar.cjs` (script pontual, gitignored). Total do parcelamento BTG salta de R$15.388,92 (4 parcelas) pra **R$69.250,14** (18 parcelas) — número bem maior, mas agora reflete o compromisso real completo, não só o pedaço que a planilha tinha.

### Confirmado: "usado" do BTG e "comprometido em parcelas" são métricas diferentes, de propósito (30/08)

Luiz notou que o BTG usa "só pra Usina Solar", mas o "usado" do limite (R$57.629,38, ao vivo da Pluggy) é MENOR que o total das 18 parcelas restantes que calculamos (R$69.250,14) — R$11.620,76 de diferença, quase exatamente 3 parcelas. Verificado com ele: **já foram pagas 6 parcelas** (bate com nosso calendário — parcela 6 cai em ago/2026, restam 18) e **o "usado" do limite está certo**. Conclusão do próprio Luiz, que faz sentido: **o BTG não trava o parcelamento inteiro de uma vez no limite** — são métricas diferentes por natureza, não um erro de dado. Não mudei nada no calendário de parcelas (confirmado correto); só adicionei uma nota na tela ("Comprometido em parcelas futuras" → texto explicando que esse total é independente do "usado" de Cartões de crédito) pra essa dúvida não voltar.

### Categorias sem barra — silenciosa até estourar (30/08)

Luiz não gostou das barras coloridas (accent/danger) indicando gasto vs. meta por categoria — pediu pra pensar outras formas. Mostrei 5 alternativas lado a lado (barra neutra com excesso destacado, número+seta, silencioso-só-alerta, texto de diferença, pontinho de status); escolheu a "silenciosa" com um ajuste: meta em negrito, gasto em peso normal.

`CategoryRow` reescrito: sem `progressTrack`/`progressFill` (removida só dali — cartões de crédito continuam com barra, não foi tocado). Categoria dentro da meta fica só texto puro, sem cor nem ícone. Categoria que estourou (`spent > planned`) ganha `AlertTriangle` + fundo `--danger-soft` na linha inteira + valores em `--danger`. Meta usa peso 600 (`--fw-semibold`, o teto do design system — nunca `<strong>` puro, que renderiza ~700/800 e violaria "nunca Bold/Black").

### Categorias recomeçadas do zero, com hierarquia pai/filho (30/08)

Luiz decidiu recomeçar as categorias de despesa do zero em vez de tentar encaixar a estrutura antiga (misturada, sem hierarquia) — as 1.109 transações + 368 metas antigas foram genuinamente valiosas pra validar o produto, mas ele preferiu limpar tudo e recadastrar certo a partir de setembro, em vez de carregar a bagunça pra frente.

**Apagado** (irreversível, confirmado explicitamente antes): as 47 categorias que existiam (35 despesa + 5 investimento — essas nunca tiveram nenhuma transação real, resíduo do import original — + 7 receita), as 1.109 transações ligadas a elas (R$175.817 de receita real incluído) e as 368 metas (BudgetTarget). **Preservado**: os 177 parcelamentos (`UpcomingInstallment`) — perderam a categoria (`categoryId = null`), a serem recategorizados manualmente agora que a árvore nova existe.

**Árvore nova criada** (56 categorias: 13 pais, 40 filhas, 3 soltas) — o schema já suportava `parentId`/`children` desde o início, só nunca tinha sido usado. Pai é só rollup pra gráfico geral (ainda não construído); meta e transação real sempre na folha.

- Moradia → Aluguel, Luz+Gas+Água, Telefonia+Internet
- Transporte → Uber/99, Transporte (Ônibus/Trem/Taxi), Locação de Carro, Gasto Carro
- Viagens → Hospedagem/Pacotes, Passagens
- Esportes → Academia, Natação, Assessoria de Corrida
- Cuidado Pessoal → Barbeiro, Tattoo
- Vida Social → Restaurante, Bares, Baladas (renomeado de "Saídas" — Luiz corrigiu: "saída" já significa gasto no modelo dele, todo gasto É uma saída; nomear um grupo específico assim confundia)
- Compras → Equipamentos, Roupas & Calçados, Móveis, Itens de Casa, Esportivos, Livros & Papelaria, Outros (sem distinção Online/Shopping — Luiz decidiu que canal de compra não importa, só tipo)
- Saúde → Farmácia, Plano de Saúde, Terapia, Nutrição, Cirurgia Estética
- Alimentação → Supermercado, Delivery
- Casa (serviços) → Lavanderia, Gastos Serviço Casa
- Lazer → Cinema, Streaming
- Serviços Digitais → Services (Adobe...), Services (Server...)
- Administrativo/Financeiro → Imposto-Contador, Gastos Jurídicos, Empréstimo Concedido
- Soltas (sem pai) → Usina Solar (é uma compra parcelada, não "casa"), Educação, Presentes

**Bug pego e corrigido no processo**: `/budget-target/review` e `PUT /budget-target` não filtravam categoria-mãe — deixariam setar meta direto em "Moradia" em vez de em "Aluguel", quebrando a separação pai=rollup/filha=meta real. Corrigido com `children: { none: {} }` (só categoria-folha) no review, e uma validação equivalente no PUT (rejeita com 400 se a categoria tiver filhos).

**Pendência explícita**: recategorizar os 177 parcelamentos (hoje sem categoria) usando a árvore nova — Luiz vai indicar caso a caso, mesmo padrão da rodada anterior de "bater parcela com cartão".

## Árvore de categorias de Orçamento (desenhada em 30-31/08, ainda NÃO criada no banco)

Documento vivo — Luiz revisita e atualiza essa árvore aqui antes de qualquer criação/alteração no banco. É o desenho final depois de várias rodadas de ajuste; reflete a árvore de `Category` (`parentId`/`children`, até 3 níveis: pai → filha → neta). Pai é só rollup pra gráfico geral (dashboard); meta e transação real sempre na folha (filha ou neta, nunca no pai — ver bug corrigido em 30/08 que impedia meta em categoria-mãe).

- **LR** (custos da empresa) — *Software* → Adobe, Figma, Apple, Gmail, Claude Code · *Infraestrutura* → Digital Ocean, Domain · *Fiscal* → Imposto - Contador · Equipamentos
- **Moradia** — Aluguel, Luz, Gás, Água, Telefonia, Internet, Faxina, Reparos, Móveis, Itens de Casa, Lavanderia
- **Transporte** — Uber/99, Taxi, **Transporte Coletivo** → Carona, Trem, Ônibus · **Carro** → Aluguel, Compra, Gasolina, Pedágio, Estacionamento, Multa · **Bicicleta** → Acessórios, Manutenção, Compra
- **Viagens** — Hospedagem, Passagens, Pacotes, Passeios
- **Lazer** — Cinema, Streaming, Games
- **Esportes** — Academia, Natação, Assessoria de Corrida
- **Cuidado Pessoal** — Barbeiro, Tattoo, Cosméticos, Cirurgia Estética
- **Vida Social** — Bares, Baladas, Museu, Show, Exposições
- **Alimentação** — Supermercado, Delivery, Restaurante
- **Saúde** — Farmácia, Plano de Saúde, Terapia, Nutrição
- **Educação** — Livros, Cursos
- **Administrativo** — Empréstimo Concedido, **Jurídico** → Detran, Documentos, Processos
- **Presentes** — Geral *(placeholder — trocar quando houver subcategoria real)*
- **Outros** — Usina Solar *(é uma compra parcelada, não é "casa")*
- **Papelaria** — Geral *(placeholder)*
- **Roupas & Calçados** — Roupas, Calçados, Acessórios

Total: 16 pais, ~52 filhas, ~20 netas.

**Decisões já tomadas nessa reconstrução** (não repetir a pergunta):
- Categorias antigas (35 despesa + 5 investimento nunca usadas + 7 receita, com 1.109 transações e 368 metas) foram **apagadas de propósito** em 30/08 — Luiz decidiu recomeçar limpo em vez de encaixar estrutura antiga bagunçada. Os 177 parcelamentos (`UpcomingInstallment`) foram preservados, sem categoria.
- "Saídas" foi descartado como nome de categoria — pro Luiz, "saída" = qualquer gasto no modelo dele (Entradas e Saídas), não uma categoria específica. O que seria "Saídas (Restaurante, Bares...)" virou "Restaurante" dentro de Alimentação + "Bares/Baladas/Museu/Show/Exposições" dentro de Vida Social.
- "Compras" foi removida por ser genérica demais — suas subcategorias foram redistribuídas (Equipamentos → LR, Móveis/Itens de Casa → Moradia, Papelaria/Roupas & Calçados → viraram pai próprio).
- "Serviços Digitais" e "Casa (serviços)" foram removidas por ficarem vazias depois da redistribuição.
- Viagens fica **fora** de Lazer (decisão do Luiz, contra minha sugestão inicial de juntar) — tem peso de gasto próprio.

**Criada no banco em 31/08** — 95 categorias reais (16 pais, 7 sub-pais de 2º nível, 72 folhas). `tmp-import/rebuild-categories-v2.cjs` é o script que criou (recria do zero se precisar rodar de novo — mas cuidado, roda `INSERT`, não é idempotente). Bug pego e corrigido no processo: o script classificava `kind` batendo pelo NOME da categoria (lista `ESSENTIAL_LEAVES`), e "Aluguel" existe em dois lugares (Moradia = aluguel do apê, essencial; Transporte > Carro = aluguel de carro, não-essencial) — o script marcou os dois como essencial por engano. Corrigido manualmente depois de conferir.

**Pendente**: recategorizar os 177 parcelamentos (`UpcomingInstallment`, hoje sem categoria) usando essa árvore nova — Luiz vai indicar caso a caso.

**Ajuste em 31/08**: "Usina Solar" (dentro de Outros) virou categoria-mãe — ganhou 4 filhas: Luz, Custo, Mão de Obra, Administrativo (essa colide de nome com o "Administrativo" top-level, mas o contexto — dentro de Usina — deixa claro que são coisas diferentes; schema permite, `@@unique([name, parentId])` é por par). 75 folhas reais agora (era 72).

**Ajuste em 31/08**: "Esportes > Assessoria de Corrida" virou "Esportes > Corrida" (categoria-mãe) com 3 filhas: Assessoria, Equipamentos, Inscrições. As 3 parcelas que já estavam categorizadas ali (RENATO VELOSO ASSESSO → Assessoria; gel corrida ×2 → Equipamentos) foram realocadas pras folhas certas. 77 folhas reais agora.

**Mesmo dia**: "Esportes > Academia" e "Esportes > Natação" também viraram categorias-mãe — Academia ganha Equipamentos, Matrícula, Suplementos; Natação ganha Equipamentos, Assessoria. As 4 parcelas de "academi korpus" (mensalidade) foram realocadas pra Academia > Matrícula. 80 folhas reais agora.

⚠️ **Nota pendente**: "academi korpus" tem exatamente o mesmo padrão suspeito já visto no "Aluguel" removido em 30/08 — 4 parcelas futuras (x8 a x11) com o MESMO valor todo mês, o que cheira a mensalidade recorrente sem fim marcada como se fosse parcela de compra finita. Ainda não resolvido — precisa confirmar com o Luiz se isso deveria estar em `UpcomingInstallment` (que representa compromisso com fim) ou se é só um custo fixo recorrente que não pertence ali.

**Parcelas categorizadas (31/08)**: dos 177 parcelamentos, 141 foram categorizados automaticamente pelo nome do comerciante (`tmp-import/categorize-installments.cjs`) — ex: "airbnb"/"AIRBNB PLATAFORMA DIGITAL" → Viagens > Hospedagem, "DELL" → LR > Equipamentos, "tokstok"/"TOKSTOK..." → Moradia > Móveis, "Usina Solar" (as 18 parcelas reais do BTG) → Outros > Usina Solar > Custo. **36 parcelas em 13 compras ficaram sem categoria de propósito** — nomes genéricos demais pra adivinhar com segurança (AMAZON MARKETPLACE/AMAZONMKTPLC com só o código do vendedor, "A G GRAFICA LTDA", "Bruno ArtMache", "estilhaços", "TicketSports") — melhor sem categoria do que categoria chutada errada. `InstallmentReviewModal` ganhou uma coluna de categoria (dropdown com os 75 caminhos "Pai > Filha"), `PUT /upcoming-installments/group` aceita `categoryId` agora (só folha, mesma regra do `PUT /budget-target`) — Luiz resolve os 13 restantes por lá quando quiser.

### Limpeza de sujeira pedida por Luiz (31/08, mesmo dia)

Depois de criar a árvore, Luiz pediu uma varredura geral: "não quero um sistema com sujeiras e coisas que não estamos usando". Achados e o que foi feito:

- **Removido** (sem risco, era só scratch local nunca versionado): `tmp-import/import-real-orcamento.{js,cjs}`, `future-installments.json`, `orcamento.json`, `parsed.json`, `skipped.json`, `parse{,-orcamento}.js`, `seed{,-orcamento}.js`, `rebuild-categories.cjs` (v1, superado pelo v2) — todos artefatos de fases anteriores do projeto, já sem função (dado já está no banco ou foi substituído). Mantidos: as 2 planilhas reais (`.xlsx`, são documento-fonte, não gerado) e os scripts recentes que ainda documentam como o dado atual foi construído (`extend-usina-solar.cjs`, `import-caixa-installments.cjs`, `rebuild-categories-v2.cjs`).
- **Corrigido**: o tipo `Category` no frontend (`api.ts`) ainda tinha `essential: boolean` e `usage: 'personal'|'business'|null` — resíduo do modelo antigo (antes de `kind` existir), nunca batia com o que a API de fato manda há dias. Removidos os dois campos, `Category` agora usa `kind: CategoryKind` (o tipo real). `tsc` confirmou zero lugar lendo esses campos — eram mortos de verdade, não só desatualizados.
- **Achado, não removido — perguntei antes**: `Category.usage` no **schema do banco** (não só o tipo TS) não é lido nem escrito em lugar nenhum do código — candidato real a sair do schema, mas isso é migração (mexe na estrutura do banco), então não fiz sozinho. `CategorizationRule` (model + `backend/src/services/categorization.ts`, 34 linhas) também está com zero uso hoje — mas tem um TODO explícito em `pluggy.ts` linkando ele ao sync de transação futuro ("rodar sugestão de categoria antes de salvar"), então não é sujeira abandonada, é peça de um recurso ainda não construído — recomendo manter.

### Campo "Descrição" nas parcelas — anotação por cima do nome real do comerciante (31/08)

O nome que vem da fatura do cartão costuma ser ilegível ("AMAZONMKTPLC HEIMONLTD") — Luiz pediu um campo pra ele mesmo detalhar o que a compra foi de verdade. `UpcomingInstallment.note` (migração `20260831210000_installment_note`, `ADD COLUMN` simples) — nunca sobrescreve `description` (que continua batendo com a fatura real, útil pra conferência futura). Editável na ferramenta "Revisar parcelas" (mesma regra de grupo — aplica em todas as parcelas da mesma compra de uma vez) e exibido na tabela "Comprometido em parcelas futuras" do Orçamento: quando tem nota, mostra ela em destaque com o nome real do comerciante embaixo, pequeno, cinza (referência, não é o texto principal mais).

### Sync real de transação de cartão de crédito (31/08) — o "próximo passo" que ficou anotado o tempo todo

Botão "Atualizar transações" em Orçamento → Cartões de crédito. `POST /api/credit-cards/sync-transactions` puxa `GET /v2/transactions` de TODA conta CREDIT conectada via Pluggy (hoje: BTG e C6 — 99 e Sofisa não têm cartão de crédito na Pluggy, só conta corrente, fica pra uma rodada futura) e grava:

- **`Transaction`** (source: "pluggy", `externalId` único evita duplicar em sync repetido) — uma por linha de fatura real. Transação tipo `CREDIT` na fatura (pagamento/estorno) vira `isTransfer: true`, não conta como gasto.
- **`UpcomingInstallment`** pras parcelas restantes de compra parcelada — usa `creditCardMetadata.{installmentNumber,totalInstallments,billForecastDate}` que a Pluggy manda por transação (confirmado real em 30/08). `externalId` (`pluggy:<id>:<parcela>`) também evita duplicar.

**Testado com dado real (31/08)**: 417 transações novas (36 BTG + 381 C6), 68 parcelas futuras identificadas, 83 categorizadas sozinhas (mapeamento `PLUGGY_CATEGORY_MAP` — só "Taxi and ride-hailing" → Uber/99 por enquanto, conservador de propósito: só categoria da Pluggy já vista numa transação real). Rodado de novo pra confirmar idempotência: 0 novo, 417 pulados — sem duplicar.

**Bug pego e corrigido antes de considerar pronto**: a Pluggy manda UMA transação por MÊS de fatura pra compra parcelada, cada uma com seu próprio "parcelas restantes a partir daqui". Projetar o restante a partir de TODA transação (não só a mais recente) duplicava pesado — a Usina Solar sozinha tinha 21 faturas mensais reais, cada uma projetando o restante, virando 179 linhas sobrepostas pra só 19 datas de vencimento distintas. Corrigido: agrupa por (descrição + valor + cartão) e só projeta a partir da fatura com o `installmentNumber` mais alto do grupo.

**Duplicata real entre o sync novo e o que já existia**: a Usina Solar tinha 18 linhas manuais ("Usina Solar x7"–"x24", calculadas à mão a partir do que o Luiz lembrava) — **o dado real do sync mostrou 20 parcelas restantes, de abril/2026 a novembro/2027, divergindo do cálculo manual**. Como agora existe fonte real e autoritativa, as 18 linhas manuais foram apagadas e substituídas pelas 20 reais (categorizadas em Outros > Usina Solar > Custo). Mais 6 duplicatas confirmadas entre C6 sincronizado e entradas manuais antigas (mesmo valor exato, nome real bate): "Bruno ArtMache"→BRUNO DALTRO PAPEL, "estilhaços"→MP ESTILHACOSDISCOS, "farmacia"→PAGUE MENOS (farmácia real), "academi korpus"→ACADEMIA KORPUS JP — essas 4 mantiveram a categoria. **2 duplicatas onde o nome real contradisse a categoria antiga** ("nutricao" tinha valor idêntico a "LA ODONTOLOGIA INTEGRA" — é dentista, não nutrição; "amazon whye" idêntico a um débito "MASTERCARD" genérico, não confirma whey protein) — a entrada manual errada foi apagada, mas a real ficou **sem categoria de propósito**, pra não carregar a categoria errada adiante.

**3 possíveis duplicatas de confiança menor, não mexidas** — valor bem próximo (não exato) mas nome real não bate conceitualmente com o rótulo antigo, deixadas pro Luiz confirmar: "compras casa" (R$97,56) vs "AMAZON MARKETPLACE" (R$97,60); "passagens mae" (R$91,59) vs "DL*BOOKINGCOM" (R$91,61, é reserva de hotel, não passagem aérea); "luminarias"/"AMAZON MARKETPLACE" (R$60,97/61,01) vs "RDSAUDE ONLINE" (R$60,96, é serviço de saúde) — três valores parecidos demais pra decidir sozinho com segurança.

### Moradia ganha "Seguro Residência" + bug no "Revisar orçamento" (31/08)

Nova folha: Moradia > Seguro Residência (essencial). Aproveitei pra conferir se "Revisar orçamento" reflete a árvore nova — reflete (busca direto do banco, sem lista fixa), mas achei um bug real: a lista mostrava só o nome da folha ("Aluguel", "Assessoria", "Acessórios", "Administrativo"), sem o pai — e agora várias folhas têm o mesmo nome em pais diferentes DE PROPÓSITO (Aluguel existe em Moradia e em Transporte > Carro; Assessoria existe em Esportes > Corrida e em Esportes > Natação; Acessórios em Roupas & Calçados e em Transporte > Bicicleta). Sem o caminho completo, impossível saber qual é qual.

Corrigido: `/budget-target/review` agora devolve `path` (ex: "Transporte > Carro > Aluguel" pros casos de 3 níveis), ordenado pelo caminho completo (não só pelo nome da folha, senão duplicata de nome ainda ficaria espalhada na lista). `BudgetReviewModal` mostra o caminho do pai em cinza pequeno acima do nome da categoria.

### "Imposto - Contador" separado em duas (31/08)

Luiz achou estranho ver "Imposto - Contador" junto numa linha só do "Revisar orçamento" (print sem o caminho do pai, provavelmente de antes do fix documentado acima) e pediu confirmação de onde vinha cada categoria antes de mexer — conferido direto no banco: só existia UMA categoria "Imposto - Contador" (não tinha duplicata), em LR > Fiscal. Separada em duas folhas distintas: **LR > Fiscal > Imposto** e **LR > Fiscal > Contador**, ambas essenciais. 82 folhas reais agora.

### Sync automático diário de transação de cartão (01/09)

Luiz pediu pra automatizar o "Atualizar transações" em vez de precisar clicar toda vez. `backend/src/services/scheduler.ts` — `setInterval` simples (sem dependência nova tipo node-cron), roda 1x por dia, chamando a mesma `syncAllBrokersCreditCardTransactions` que o botão manual usa (refatorada pra fora da rota, reaproveitada pelos dois). Primeira rodada 1 minuto depois do servidor subir (não espera 24h depois de um restart), erro num broker não derruba o processo nem trava os outros.

**Por que 1x/dia, não "quando passar 4-5 dias desde a última transação"**: a própria Pluggy só resincroniza com o banco 1x por dia por conta própria, e o lookback window dela (4-5 dias) já cobre atraso sozinho — rodar mais que 1x/dia não traria dado mais novo, só bateria a API à toa. Testado real: primeira rodada automática (01/09) achou 2 transações novas desde o sync manual de minutos antes.

### Resumo mensal — banner no Dashboard + modal + PDF (01/09)

Luiz pediu um "resumo do mês que fechou" (highlights: gasto vs meta, investimento, destaque de rentabilidade) e perguntou qual a melhor forma de mostrar — página nova, seção que some, ou modal temporária. Decidido junto: **banner no Dashboard, visível só do dia 1 ao 5 do mês** (mesmo padrão do banner "revisar orçamento" que já existe em Orçamento) + **modal com o resumo completo** ao clicar "Ver resumo". Escopo combinado: só Orçamento + Patrimônio por agora — Projetos fica de fora até esse módulo ser remontado (não tem "Entradas" real conectada ainda).

Sem endpoint novo — `MonthlySummaryModal.tsx` reaproveita `budgetSummary` (mês fechado, passado como parâmetro) e `wealthOverview` (já calcula `investedThisMonth` e `movers`, usado aqui como "destaque de rentabilidade" — maior alta positiva; se nenhum ativo subiu, mostra isso explicitamente, não inventa destaque).

**"Baixar PDF" via `window.print()`** — sem biblioteca nova (nada de jspdf/html2canvas), usa o "Salvar como PDF" nativo do diálogo de impressão do navegador. CSS de impressão dedicado (`@media print`): esconde a página inteira por trás do modal (`body * { visibility: hidden }`) e mostra só o `.sheet`, escondendo botões/chrome via `.noPrint`. Bug pego antes de testar: a classe `.noPrint` tinha ido pro container inteiro do modal por engano, o que escondia o conteúdo junto — corrigido pra ficar só no header (botões).

**Nota real**: resumo de agosto sai com "Total gasto: R$0,00" — não é bug, é porque as categorias/transações de agosto foram zeradas na limpeza de 31/08 ("começar do zero a partir de setembro"). Só vai ter número de verdade ali a partir do resumo de setembro em diante.

### Categorias em accordion por pai + resumo previsto/gasto no topo (01/09)

Com ~80 folhas reais, listar tudo solto (como era desde 30/08) ficou ilegível. `/budget-summary` ganha `parentId`/`parentName` por categoria (sempre a categoria-mãe de TOPO, mesmo pra folha 3 níveis fundo tipo Transporte > Carro > Aluguel — agrupa em "Transporte", não em "Carro"). Frontend: cada seção (essencial/não essencial) ganha uma barra de resumo (Previsto/Gasto somando todas as categorias daquela seção) no topo, e as categorias agora ficam em accordion por pai — fechado por padrão, mostra o agregado (soma das filhas) na header; abre pra ver cada folha. Testado real: "Moradia" fechado mostra "R$0 / R$5.203,66", abre e lista Aluguel/Internet/Gás/Luz/Lavanderia/Telefonia/Seguro Residência/Água cada um com sua própria meta.

### Dashboard: categorias-mãe + últimas compras reais + alerta de sem categoria (01/09)

Três ajustes no Dashboard, todos reagindo à árvore nova de categorias e ao sync real de transação:

- **"Orçamento do mês"**: mostrava as ~80 folhas soltas (ilegível) — agora agrega por categoria-mãe (`groupByParent`, client-side, mesmo dado de `/budget-summary`), ordenado por quem gastou mais.
- **"Últimas transações"**: filtrava por mês corrente — nos primeiros dias do mês novo ficava vazio (compra real mais recente ainda é do mês anterior no cartão). Tirado o filtro de mês, mostra as 5 mais recentes de verdade, sem depender de estar "dentro do mês".
- **Alerta de compra sem categoria**: banner (mesmo padrão do resumo mensal) mostrando "N compras no cartão sem categoria" sempre que existir alguma — abre `TransactionReviewModal` (novo componente, mesmo padrão do `InstallmentReviewModal`, mas pra `Transaction` — gasto que JÁ aconteceu, agrupado por comerciante exato, sem edição de valor/cartão). Backend: `GET /transactions/uncategorized-groups` + `PUT /transactions/group`. Testado real: 298 transações sincronizadas da Pluggy estavam sem categoria (132 comerciantes distintos) — categorizei "CAPPTA *MANUS LANCHES" (4 compras) como Restaurante ao vivo, confirmado persistido no banco.

### Resumo mensal enriquecido — gráfico + 3 destaques + Projetos (01/09)

Luiz achou o resumo "pobre" e pediu mais números e gráfico. Enriquecido:

- **Orçamento**: ganhou o gráfico de pizza (`ClientPieChart`, mesmo componente já usado em Orçamento) de gasto agregado por categoria-mãe + destaque de texto "categoria que mais gastou".
- **Patrimônio**: mantido o destaque de investimento (`wealth.movers`, maior alta positiva).
- **Projetos**: seção nova. `/projects-summary` ganhou parâmetro `month` (antes só `year`, sempre calculava "esse mês" a partir de `now` — não dava pra pedir um mês fechado específico) e um campo novo `bestProjectThisMonth` (maior recebimento por projeto, filtrado pro mês pedido, calculado a partir de `ProjectReceipt` real).

**Achado real ao testar**: o resumo de agosto sai vazio nos 3 blocos — não por bug, mas porque **não existe nenhum `BudgetTarget` pra agosto** (a limpeza de 30/08 zerou tudo, e o Luiz só configurou metas a partir de setembro) e **`ProjectReceipt` tem 0 linhas no banco** (Projetos nunca foi populado com dado real). O gráfico de pizza e os 3 destaques só vão aparecer de verdade a partir do resumo de setembro (visto em outubro), quando finalmente existe meta + gasto real no mesmo mês pra comparar.

### 3 ajustes rápidos (01/09): accordion +/-, LR→Empresa, banco na transação

- Accordion do Orçamento trocou seta ▸/▾ por ícone +/- (Lucide `Plus`/`Minus`), e ganhou fundo `--accent-soft` (mesmo azul claro do design system) quando aberto — referência visual que o Luiz mandou. Ícone vira um badge circular branco (`--surface`) quando aberto.
- Categoria "LR" renomeada pra "Empresa" (mesma árvore, só o nome).
- "Últimas transações" no Dashboard mostra o banco de origem (`Transaction.broker.name`, já vinha do backend, só não estava no tipo/render do frontend) — ex: "Restaurante · C6".

### Projeto renomeado: Financial Hub → Command OS (01/09)

Luiz decidiu renomear — "é onde eu vou controlar minha vida", não é só finanças. Atualizado onde o nome aparece de verdade pro usuário: título da aba (`index.html`), nome/short_name do manifest do PWA (`vite.config.ts` — nome que aparece ao instalar o app na tela inicial), wordmark no sidebar (`AppLayout.tsx`), título do PDF do resumo mensal, log de boot do backend. **Não mexido de propósito**: nome de pasta do projeto (`~/Desktop/Work/CLAUDE/Financial-Hub`), nome dos pacotes npm (`financial-hub-backend`/`financial-hub-frontend`) e o histórico de decisões já registrado neste documento (narrativa de "o que aconteceu" fica como aconteceu, sob o nome de então) — só o nome do PRODUTO como o Luiz vê/usa mudou.

### Configurações: excluir conexão + Phantom/Nomad/INCO consolidados (01/09)

Luiz pediu 3 coisas na mesma seção de Conexões: (1) opção pra deletar conexão que não usa mais, (2) sincronizar o Phantom (que já tinha backend pronto, só faltava botão), (3) subir extrato PDF do Nomad e do INCO — tudo dentro de Configurações em vez de espalhado.

- **`DELETE /api/brokers/:id`** (novo): antes de apagar, conta `Transaction`/`PositionSnapshot` reais ligados àquele broker — se tiver qualquer um dos dois, recusa (409) e devolve as contagens em vez de deletar; só remove de fato conexão que nunca teve dado sincronizado ou já está vazia. Testado ao vivo: tentativa de deletar o BTG (36 transações, 273 posições) foi recusada com a mensagem certa; broker seguiu existindo depois.
- **Botão "Excluir"** em cada linha de Configurações, com confirmação em 2 cliques (primeiro clique só troca o texto pro "Confirmar exclusão?", nada é enviado ainda — testado que o primeiro clique não dispara nenhum request de rede).
- **Sincronizar Phantom**: o backend (`POST /brokers/:id/sync`) já tratava `dataSource: "onchain_query"` desde muito antes — só faltava o botão aparecer na tela pra esse tipo de broker (Settings.tsx só mostrava ação pra `dataSource === "pluggy"`). PHANTOM/PHANTOM_BASE/PHANTOM_BTC/PHANTOM_ETH (4 redes, mesma carteira) ganharam "Sincronizar".
- **Upload de extrato pro Nomad e INCO**: `StatementUploadModal` já existia mas só era oferecido dentro de Patrimônio, e só pro Nomad (comentário explícito no código: "INCO também é standalone+manual, mas não tem PDF nesse formato; usaria o parser errado"). Botão "Atualizar por extrato" agora aparece em Configurações pros dois. **Ressalva real, não resolvida**: o parser (`parseNomadStatement`) é específico do formato Apex Clearing do extrato da Nomad — se o PDF do INCO vier num layout diferente, a prévia vai voltar vazia com aviso "PORTFOLIO não encontrada" em vez de inventar posição errada (a confirmação continua manual, então não corrompe dado), mas o parser em si só vai ficar certo pro INCO quando o Luiz de fato subir um extrato real de lá pra eu ajustar a regex pro layout dele.

### Configurações: CRUD de categoria (01/09)

Luiz pediu pra não depender mais de mim rodando SQL na mão quando surgir categoria nova — "já que temos as categorias já organizadas... adicionar uma sessão pra editar, remover e adicionar novas categorias".

- **`GET /api/categories` corrigido**: só trazia 2 níveis (mãe + filho), escondendo o neto — a árvore real tem 3 (ex: Transporte > Carro > Aluguel). Agora inclui `children.children`.
- **`POST /api/categories`**: cria mãe (`type` obrigatório) ou subcategoria (`parentId`, herda o `type` do pai — não dá pra misturar receita/despesa na mesma árvore). Trava em 3 níveis.
- **`PUT /api/categories/:id`**: só nome e `kind` — mover categoria de lugar (reparent) ficou de fora de propósito, não foi pedido e é mais arriscado.
- **`DELETE /api/categories/:id`**: recusa (409) se tiver subcategoria, ou se tiver `Transaction`/`BudgetTarget`/`UpcomingInstallment`/`CategorizationRule` reais gravados nela — mesmo padrão de proteção da corretora, nunca cascata silenciosa.
- **Frontend**: `CategoryManager.tsx` — árvore com accordion (expandir/colapsar), + pra nova subcategoria (só até neto), lápis pra editar, lixeira com confirmação em 2 cliques, tudo dentro de Configurações.
- **Bug pego em teste manual, antes de ir pro ar**: a checagem de profundidade original só olhava 1 nível acima do pai (`parent.parentId`) pra decidir se already é neto — isso trata filho (profundidade 2) e neto (profundidade 3) como a mesma coisa, e deixou criar um bisneto de verdade num teste direto (`POST` com `parentId` de "Detran", que já é neto). Corrigido pra subir 2 níveis (`parent.parent.parentId`) antes de decidir a profundidade; registro de teste apagado do banco, contagem de categorias confirmada intacta (109) depois.

### "Excluir conexão" virou "Arquivar" (01/09)

Luiz testou o `DELETE /brokers/:id` da entrega anterior e não conseguiu excluir nenhuma — a mensagem de proteção aparecia sempre. Investigando: **toda** corretora do sistema tem `PositionSnapshot` real, até as "nunca sincronizadas" (vieram da importação da planilha original) — de PHANTOM_ETH com 1 posição até BTG com 273. Ou seja, a proteção contra apagar dado real (certa em princípio) bloqueava 100% das tentativas, sempre — a feature nascia inútil na prática.

Perguntei direto: como deveria funcionar, já que toda corretora tem histórico? Luiz escolheu **arquivar** em vez de excluir de verdade. Trocado:

- `Broker.archivedAt DateTime?` (novo). `POST /brokers/:id/archive` / `POST /brokers/:id/unarchive` substituem o `DELETE` (removido — ficaria morto na prática, e "não quero sujeira" já é regra do projeto).
- Corretora arquivada some de: `fetchAllSnapshots()` (por isso some de Patrimônio e do resumo mensal, filtro num ponto só, todo o resto herda), `GET /credit-cards` (fatura ao vivo), sync automático diário e o botão "Sincronizar" manual (recusa com 409 se tentar sincronizar arquivada).
- **Nada é apagado** — só sai do filtro. Desarquivar traz de volta o histórico inteiro, sem "restaurar" nada (nunca saiu do banco).
- Settings.tsx: lista virou 2 blocos — ativas (com Sincronizar/Reconectar/Atualizar por extrato/Arquivar) e "Arquivadas" (esmaecida, só com Desarquivar).
- Testado ao vivo: arquivei o PICPAY de verdade → sumiu de `/positions` na hora → desarquivei → voltou a existir no `GET /brokers` com `archivedAt: null` (não reapareceu em `/positions` porque o snapshot mais recente dele é de 09/2022, fora da janela de "ativo hoje" de 2 meses — comportamento correto e anterior a essa mudança, não regressão).

### Corretoras arquivadas ficam ocultas por padrão (01/09)

Ajuste rápido: a seção "Arquivadas" em Configurações agora começa colapsada, atrás de um botão "Mostrar arquivadas (N)" — antes ficava sempre visível, poluindo a tela justamente pras corretoras que o Luiz não quer ver no dia a dia. Confirmado ao vivo com os 8 arquivamentos reais que ele já tinha feito (Binance, Easynvest, Monetus, Nexoos, Nuinvest, Picpay, XP Investimento, Órama).

### 3 ajustes (01/09): corte de categorização, categoria de encargos, total em destaque, regra de entrada

**1. Categorização retroativa abandonada, começa a valer a partir de hoje.** Luiz não vai voltar categorizando as 72 transações antigas sem categoria — `CATEGORIZATION_TRACKING_START = 2026-09-01` filtra `GET /transactions/uncategorized-groups` (usado pelo banner do Dashboard e pelo `TransactionReviewModal`) pra só considerar transação a partir dessa data. As 72 antigas continuam no banco e contando nos totais de gasto normalmente — só param de aparecer no aviso/modal de revisão, pra sempre.

Também percebeu (olhando as antigas) que várias eram **custo operacional do próprio cartão**: 12× "Tarifa Anuidade Diferenciada" (R$98 cada, cobrada mensalmente), "Encargos de Refinanciamento", "IOF Rotativo"/"Iof", "Juros de Mora", "Multa"/"Multa Contratual" — sinal de um período com fatura rotativa. Criada `Administrativo > Encargos de Cartão` e categorizadas as 20 transações reais que batiam esse padrão (R$1.376,04 no total). Ficou de fora "Loungekey" (assinatura de sala VIP, não é encargo) e "MASTERCARD" genérico (ambíguo demais pra adivinhar) — ambos já saem do aviso pelo corte de data de qualquer forma.

Confirmação: também é a deixa pra registrar o hábito real do Luiz — ele não usa conta corrente, todo pagamento é no cartão de crédito. Isso reforça por que o sync de conta BANK nunca foi prioridade (ver ponto 3 abaixo).

**2. "Total do mês" em destaque no Dashboard.** A barra de total (Orçamento do mês) tinha o mesmo estilo visual das barras por categoria — pedido pra separar e destacar, "bater o olho e ver a diferença". Ganhou fundo próprio (`--fill-muted`), rótulo maiúsculo, valor bem maior (20.8px vs 13.5px das linhas normais) e barra mais grossa (14px vs 8px) — vira claramente uma linha diferente das outras, não mais uma barra igual no meio da lista.

**3. Regra travada: "entrada" nunca é inferida de transferência entre contas.** Luiz faz muita transferência entre as próprias contas (BTG↔C6, recebimento de cliente que passa pela conta corrente antes de ir pra outro lugar). Isso NUNCA pode virar `Transaction.type: "income"` só por ter chegado numa conta — só quando ele lançar manualmente "recebi R$X no dia Y". Como o sync de conta BANK (extrato corrente, diferente do sync de cartão de crédito que já existe) ainda não foi implementado, travei a regra direto no comentário de `pluggyTransactionSync.ts` pra não esquecer quando chegar a hora: futuro sync de conta BANK grava movimentação (se gravar) sempre como `isTransfer: true`, nunca como receita inferida — receita continua sendo sempre um lançamento manual explícito.

### Nomad/INCO/Wise: extrato PDF vira popup de atualização manual (01/09)

Luiz pediu pra trocar o fluxo de extrato por um popup direto: ele abre o app de cada corretora, olha o valor de cada investimento e digita ali mesmo — sem PDF, sem parser tentando adivinhar formato. Como é mês a mês, precisa continuar existindo histórico (mesma exigência de sempre) — cada "Salvar" grava um `PositionSnapshot` novo pro mês/ano de hoje, nunca sobrescreve o snapshot antigo.

- **Removido de vez** (não ficava sujeira parada): `nomadStatement.ts` (parser Apex Clearing), rotas `statement-preview`/`statement-confirm`, `StatementUploadModal.tsx`+css, e as dependências `multer`/`pdf-parse`/`@types/multer` do `package.json` — só serviam pra isso.
- **`GET /brokers/:id/positions`** (novo): última posição conhecida de cada ativo daquela corretora — não filtra pela janela de "ativo hoje" de 2 meses do Patrimônio, porque é justamente o ativo esquecido há mais tempo que mais precisa aparecer no popup pra ser atualizado. Ativo já zerado dos dois lados (marketValue e investedAmount) fica de fora. **Bug pego em teste manual antes de ir pro ar**: o valor voltava em BRL (é como fica salvo no banco) só que com o rótulo "USD" do lado — Luiz digitaria por cima olhando o valor errado (o app da Nomad mostra USD). Corrigido: desconverte de volta pra USD usando a `fxRateToBRL` gravada naquele snapshot específico antes de devolver.
- **`PUT /brokers/:id/positions`** (novo): recebe a lista completa da tela, faz upsert de `Security` + `PositionSnapshot` (mês/ano de hoje) um por um — `investedAmount` herda do snapshot anterior do mesmo ativo (não inventa custo de aquisição novo só porque o valor de mercado mudou), conversão USD→BRL usa a cotação de HOJE (não a antiga). Ativo novo (sem `securityId`) é criado na hora. Restrito às 3 corretoras (`MANUAL_POSITION_BROKERS`) — recusa em qualquer outra.
- **`ManualPositionsModal.tsx`** (novo, substitui `StatementUploadModal`): tabela editável (nome, tipo, moeda, quantidade, valor unitário, valor de mercado) pré-preenchida com o último valor conhecido de cada ativo + "atualizado MM/AAAA" por linha, botão "+ Novo ativo", aviso explícito de que zerar o valor (não remover a linha) é como marcar um investimento encerrado. Botão "Atualizar posições" em Configurações pras 3 corretoras — Patrimônio.tsx perdeu o botão de upload que só existia pra Nomad (consolidado em Configurações, mesma decisão de antes).
- Testado ao vivo: popup abriu com os 5 ativos reais da Nomad, valores corretos em USD (ex: título NVIDIA em $949,01, não o equivalente em BRL) — depois testado o salvamento via API direta com um ativo de teste descartável (criado, conferido que virou snapshot novo em 09/2026 sem tocar no histórico real de 07/2026, depois apagado do banco — `lastSyncedAt` do broker restaurado pro valor original, nada de real ficou alterado pelo teste).

### Cartão BTG/C6 agora "anda" com o mês no Orçamento — estimativa, não live (01/09)

Luiz reportou que o box de "usado" do BTG/C6 não muda ao navegar mês a mês em Orçamento — sempre o mesmo número. Raiz real: pra cartão Pluggy, `GET /credit-cards` ignorava totalmente `month`/`year` e sempre devolvia o "usado" AO VIVO de hoje, direto da Pluggy (só o cartão manual, Caixa, já era month-aware, via soma de `UpcomingInstallment`).

O problema de fundo: o banco não tem endpoint de "usado em outubro" pro futuro nem histórico real pro passado — é sempre "agora". E já tínhamos confirmado antes (30/08) que o BTG nem trava o parcelamento inteiro nesse número (métricas diferentes por natureza). Perguntei direto como ele queria que o box se comportasse ao navegar; Luiz escolheu **estimativa, deixando claro que é estimativa**.

- `GET /credit-cards`: pra mês diferente do atual, `usado(mês) = usado(hoje) − parcelas dessa corretora com vencimento entre hoje e o mês escolhido` (futuro) ou `usado(hoje) + parcelas entre o mês escolhido e hoje` (passado, "como teria sido antes das parcelas já pagas desde então"). Campo novo `estimated: boolean` avisa o frontend; nesse caso `minimumPayment`/`dueDate` (que só fazem sentido pra fatura de hoje) somem, pra não misturar dado ao vivo com projeção.
- Orçamento.tsx: badge "ESTIMADO" + nota explicando a limitação, só aparece fora do mês atual.
- **Bug lateral pego durante o teste** (não relacionado ao pedido, achado sem querer): `changeMonth` fechava sobre `month`/`year` do momento do clique — 2-3 cliques em sequência rápida no "›" (mais rápido que o React re-renderiza) computavam todos a partir do mesmo mês antigo, "perdendo" avanços. Corrigido com um `useRef` espelhando o período atual de forma síncrona. Confirmado ao vivo: 3 cliques rápidos em "Próximo mês" agora leva certinho de Set/2026 pra Dez/2026 (antes ia só até Out).
- Testado ao vivo: Set/2026 (mês atual) mostra os valores reais sem badge; Dez/2026 mostra BTG caindo de R$53.859,40 pra R$42.317,71 e C6 de R$34.764,22 pra R$26.505,62, com o badge e a nota.

### Popup de posições manuais: campos por corretora + tela legível (01/09)

Luiz mandou print do popup de atualização manual (Nomad/INCO/Wise, ver entrada anterior) — campos cortados, ilegíveis, e um pedido pra simplificar diferente por corretora, já que cada uma tem uma realidade diferente de dado:

- **Nomad**: tira Qtd./Valor unit., adiciona **Valor investido** editável (antes só existia auto-derivado, nunca digitável) — fica Ativo/Tipo/Moeda/Investido/Atual.
- **Wise**: só a reserva de emergência — tira Tipo (sempre "Renda Fixa", fixo), tira Qtd./Valor unit./Valor investido — fica só Ativo/Moeda/Valor atual.
- **INCO**: moeda sempre Real (sem seletor), sem Tipo (sempre "Renda Fixa"), sem Qtd., sem Valor unit. — fica Ativo/Investido/Atual. E os itens que **não são empreendimento de verdade** ("ATIVOS", "CDB 110%" — resíduo de um formato antigo, de 2024/2025, antes de virar item por empreendimento) somem da lista — sem apagar o histórico deles do banco, só saem do popup.
- Backend: `MANUAL_POSITION_CONFIG` (por broker) define moeda fixa/seletor, quais campos aparecem, tipo fixo e nomes a excluir; `GET`/`PUT /brokers/:id/positions` ficaram genéricos em cima dessa config — `investedAmount` agora é aceito como valor digitado (não só herdado do snapshot anterior) quando a corretora usa esse campo.
- **Tela cortada** (causa real, não só "aumentar fonte"): `.nameCell` tinha especificidade CSS menor que `.table td` (classe vs. classe+tipo), então o min-width maior do nome nunca era aplicado — corrigido pra `.table td.nameCell`. Colunas foram pra 170px (nome 260px), modal de 720px pra 920px, e os valores voltando de USD pra exibição pararam de vir com resíduo de ponto flutuante (`7513.170000000002` → `7513.17`, arredondado na desconversão).
- Testado ao vivo: as 3 telas renderizam as colunas certas (Nomad com Investido, Wise só Moeda+Atual, INCO sem ATIVOS/CDB 110% e sem seletor de moeda); medido via canvas que "Renda Fixa" cabe com folga (70px de texto em ~106px disponível); salvamento com `investedAmount` explícito testado via API (gravou 80 quando pedido, não teria calculado sozinho), depois removido do banco sem afetar dado real.

### Nomad/Wise: mais 2 rodadas de limpeza no popup de posições (01/09)

Luiz viu a lista real e apontou mais itens que não fazem sentido no popup:

- **Nomad**: "FDIC Insured Deposit" é a conta corrente (caixa parado, não investimento) e "USD" era um bucket de "valor total" agregado — os dois duplicavam/misturavam com a soma dos 3 títulos reais (o bond BRAZIL, o ETF ISHARES, o bond NVIDIA). Excluídos do popup (`excludeSecurityNames`), histórico intocado — igual ao INCO antes.
- **Wise**: só existe UM ativo de verdade aqui, o saldo da conta corrente — "CDB MAXIMA" e "FUNDO" não são tocados desde 03/2023 (carteira antiga, não existem mais). Excluídos, e o ativo que sobra ("CDB - Liquidez Diária") foi **renomeado pra "Conta Corrente"** direto no banco (mesmo `securityId`, mesmo histórico — não é um ativo novo, só o nome mudou pra refletir o que ele realmente é).
- Testado ao vivo: Nomad mostra só os 3 títulos reais, Wise mostra só "Conta Corrente" com o valor de julho intacto (R$5.515,35).

### Achado: Nomad duplicando total em setembro/2026 (01/09)

Luiz perguntou por que a Nomad estava em R$78 mil no Patrimônio — bem mais que a soma visível dos 3 ativos reais. Investigado: a Nomad tinha uma história em 2 fases. Até abril/2026, o saldo era rastreado como **um bucket só** ("USD", ~R$28-40mil/mês, desde jan/2025). A partir de julho/2026, quando o parser do extrato Apex Clearing entrou, o rastreio virou **por ativo** (BRAZIL, ISHARES, NVIDIA + "FDIC Insured Deposit" como caixa da corretora) — e o bucket antigo "USD" parou de ser salvo (maio-agosto/2026 não têm linha dele, corretamente).

Em setembro/2026 os dois formatos foram salvos **juntos, pela primeira vez** — quase certamente o popup novo (ManualPositionsModal) foi aberto e salvo carregando os 5 itens de então (incluindo USD e FDIC, que ainda não tinham sido excluídos da tela) com os valores antigos, sem editar nada. Resultado: R$38.634 (USD) + R$218 (FDIC) somados por cima dos 3 ativos reais, quase dobrando o total.

Corrigido, sem tocar em histórico legítimo:
- Apagada a linha de setembro/2026 de "USD" e "FDIC Insured Deposit" (o mês duplicado) — as linhas reais de jan/2025 a abril/2026 do "USD" continuam intactas pra evolução histórica.
- Como Luiz pediu pra remover FDIC de vez ("isso é a conta corrente"), apagada também a única linha real dele (07/2026, R$215) e a `Security` órfã resultante — diferente do "USD", que ainda tem história real anterior a preservar.
- Nomad volta a bater com os 3 ativos reais: **R$39.550,88** (antes R$78.388,83). Confirmado ao vivo no Patrimônio.

### "Primeira Milhão" reescrita: retorno real em vez de chute (01/09)

Luiz pediu pra simplificar e tornar "mais dinâmico e no cenário real": em vez de ele digitar, ano a ano, um "retorno assumido" (chute) e um "aporte no ano" numa tabela, usar a rentabilidade REAL da carteira que ele já tem + um único aporte mensal.

- **`WealthGoalYearly` removida** (tabela ano a ano com retorno chutado) — trocada por `WealthGoal.monthlyContribution` (um número só). Migração preserva a intenção que já existia: R$90.000/ano configurado virou R$7.500/mês.
- **Retorno médio real, não chute** (`computeAverageMonthlyReturnPct` em `wealthProjection.ts`): compara `marketValue` mês a mês dos últimos 12 meses de `PositionSnapshot`, mas **descontando a variação de `investedAmount`** (dinheiro novo que entrou) — senão um aporte grande num mês pareceria "rentabilidade" e infla a projeção pra sempre (double-counting: contaria o mesmo aporte 2x, uma vez como "entrou dinheiro" e outra como "taxa de crescimento" aplicada pra sempre daí pra frente). Precisa de pelo menos 2 meses de histórico; menos que isso, mostra aviso em vez de inventar taxa.
- **Projeção**: juro composto mês a mês com essa taxa real + o aporte mensal informado, até bater a meta (teto de 50 anos). Sem mais "extrapolação de meta configurada" — só existe uma taxa agora.
- Frontend: formulário virou 2 campos só (meta geral + aporte mensal), uma linha nova mostra o retorno usado ("retorno médio real: -0,15% ao mês (~-1,8% ao ano), média dos últimos 12 meses de dado real" — transparente sobre de onde vem o número), tabela "Projeção ano a ano" mantida (pediu pra "conseguir visualizar"), sem mais tag "estimado" por ano (não existe mais extrapolação, é uma taxa única).
- Testado ao vivo: retorno real calculado em -0,15%/mês a partir do histórico de 12 meses; projeção "chega lá em setembro de 2031" com aporte de R$7.500/mês; testado o salvamento (mudar aporte pra R$8.000 antecipou a data pra abril/2031, restaurado depois).

### 2 ajustes de visualização (01/09): carrossel "Por mês" e destaques por categoria

**1. "Por mês" (parcelas futuras) virou carrossel.** A lista de 15 meses quebrava em várias linhas desorganizadas. Criado `components/Carousel.tsx` — componente genérico (setas + dots, N itens por página), reaproveitável em qualquer lista curta do tipo "N por vez". Aplicado só em "Por mês" (5 por página, 3 dots pros 15 meses atuais) — "Por cartão" ficou como estava, tem poucos itens e não precisa.

**2. "Destaques do mês" mostra categoria, não o ativo.** Luiz viu "105756CG3" no Dashboard (é o CUSIP do bond BRAZIL da Nomad) e perguntou o que era — identificador técnico sem significado nenhum pra ele. Trocado: em vez de calcular a variação % por ativo individual, `wealth.ts` agora agrupa por categoria (mesma regra já usada na "Alocação de investimentos" — tipo do ativo, ou nome da corretora quando ela é "standalone" tipo Nomad/INCO) e mostra a variação da categoria inteira. Simplificou o código de quebra (não precisa mais da regra de "só ativo com dado datado deste mês" — comparar total por categoria não tem esse problema de identidade). Testado: "NOMAD +2,1%", "Renda Fixa -1,9%", "Cripto -1,5%" no lugar de tickers/CUSIPs.

**Confirmando a pergunta sobre proventos**: correto, não dá pra saber o valor exato de proventos (dividendos de ação, aluguel de FII) mesmo sabendo que um ativo é FII ou Ação — a Pluggy não manda esse dado no plano pessoal (`PositionSnapshot.dividends` fica `null`, documentado desde 25/08: "não vem no payload de `/investments`, precisaria de uma chamada extra em `/investments/{id}/transactions`"). Segue como pendência em aberto, não é bug.

### Login do app: senha de 6 dígitos + Face ID/Touch ID (01/09)

Luiz vai subir o app no servidor pra instalar no celular — antes disso, precisava de uma trava de acesso (até agora o app não tinha login nenhum, qualquer um com a URL entrava). Pediu FaceID ou senha de 6 dígitos; perguntei o estado do HTTPS no droplet (já tem domínio + certificado configurado) e a preferência (senha como mecanismo real + Face ID/Touch ID como atalho, não Face ID sozinho).

- **`AppAuth`** (novo, singleton igual `WealthGoal`): guarda só o hash bcrypt da senha de 6 dígitos. Criado no primeiro acesso (`POST /auth/setup`, só funciona uma vez — depois disso é `PUT /auth/pin`, autenticado + confirma a senha atual).
- **`WebauthnCredential`** (novo): uma linha por aparelho com Face ID/Touch ID cadastrado — `id` é o credential ID que o próprio navegador gera, `publicKey`/`counter` pra verificar login futuro, `deviceLabel` escolhido por ele ("iPhone do Luiz"). Cadastro (`POST /auth/webauthn/register-options` + `register-verify`) só funciona autenticado — não dá pra cadastrar um Face ID novo sem já ter provado quem é pela senha primeiro. Login por Face ID (`login-options` + `login-verify`) é público (é a própria tela de bloqueio usando).
- **Sessão**: token HMAC simples (`services/session.ts`), sem depender de `jsonwebtoken` — pra guardar só "autenticado até quando", um HMAC audita mais fácil que um JWT completo. Cookie httpOnly, `secure` só quando `APP_ORIGIN` é https://, 90 dias de validade (é o celular dele, não devia pedir senha toda hora).
- **Freio de força-bruta** (`services/loginThrottle.ts`): senha de 6 dígitos é só 1 milhão de combinações — sem freio, um script testa todas em minutos. 5 tentativas erradas trava 15 minutos, por IP, em memória (reseta num restart do servidor, aceitável).
- **Gate global**: `server.ts` monta `/api/auth/*` (público) e `/api/health` ANTES do middleware `requireAuth`, que trava todo o resto — testado direto por IP: `/api/brokers` sem cookie válido devolve 401, com cookie válido devolve 200. `app.set("trust proxy", 1)` porque em produção o backend fica atrás do nginx — sem isso, o freio de tentativas por IP travaria todo mundo junto (o IP visto seria sempre o do proxy).
- **`WebAuthn` (`@simplewebauthn/server`/`@simplewebauthn/browser`, v13)**: exige HTTPS de verdade (contexto seguro) — documentado no README que a senha de 6 dígitos continua funcionando sozinha se o HTTPS não estiver pronto, Face ID é só um atalho opcional em cima. `APP_ORIGIN` no `.env` (novo) define o domínio esperado — precisa bater exatamente com a URL real (protocolo + host).
- **Frontend**: `AuthGate` (novo, envolve o app inteiro em `main.tsx`) decide entre 3 telas: `SetupScreen` (sem senha ainda), `LoginScreen` (senha + botão de Face ID quando tem aparelho cadastrado), ou deixa passar (sessão válida). `PinInput` — 6 caixas com foco automático, mesmo padrão de app de banco. `SecuritySettings` (nova seção "Segurança" em Configurações): trocar senha, listar/cadastrar/remover aparelhos com Face ID, sair.
- **Ressalva documentada no README**: enquanto não existe senha configurada, quem abrir a URL primeiro é quem define — sem "esqueci a senha" (usuário único). Orientação: definir a senha imediatamente após subir no servidor.
- Testado ao vivo, ponta a ponta: setup (senha 2x pra confirmar) → app libera → trocar senha → sair → login com a senha nova → funciona. Rate limit testado direto (6ª tentativa errada bloqueia por 15min, inclusive pra senha certa). Rota protegida sem cookie confirmada em 401, com cookie em 200. Dados de teste removidos do banco antes de terminar — banco fica vazio, pronto pro Luiz definir a senha de verdade.

### Deploy real em produção (02/09): droplet compartilhado + bug do VITE_API_URL

Luiz já tinha SSH nesse droplet pra outros projetos (`aberto-cms`/Strapi, `aberto-site` staging) — usei o mesmo servidor em vez de um novo. Descoberto olhando `SERVIDOR_INFO.md` do `aberto-cms` (documentação que ele já tinha): nginx com `sites-available`/`sites-enabled`, certbot, pm2 com `ecosystem.config.js` único em `/root/ecosystem.config.js`, e um webhook próprio (`/root/nodewebhooks/webhook.js`, porta 8080) que hoje só sabe fazer deploy automático do `aberto-cms` especificamente (hardcoded), não genérico pra qualquer repo.

- **Domínio**: Luiz não queria comprar domínio novo — usou um CNAME em `command.luizrodrigues.com` (domínio que ele já tem, DNS na própria Digital Ocean) apontando pro mesmo droplet. Resolve certo (`CNAME → luizrodrigues.com → A → 143.110.146.35`), certbot emitiu certificado real sem problema.
- **Node 22 só pro build do frontend**: o droplet só tinha Node 20.14.0 (via nvm) — Vite 8/`@vitejs/plugin-react` 6 exigem `^20.19.0 || >=22.12.0`. Instalado Node 22 ADICIONALMENTE via nvm (`nvm install 22`), sem tocar no default (continua resolvendo pra 20.14.0 pros outros apps) — usado só pra rodar `npm run build` do frontend. O backend roda em produção com o Node 20 de sempre (mesmo pm2, sem mudança pros outros processos).
- **Achado real, corrigido antes de declarar pronto**: `root /root/apps/financial-hub/frontend/dist` no nginx dava **permission denied** — `/root` é `700`, o worker do nginx roda como `www-data` e não consegue nem atravessar o diretório, só falha ao tentar ler `index.html`. O site estático `luizrodrigues.com` já resolvia isso usando `/var/www/` em vez de `/root/apps` — copiado o `dist` buildado pra `/var/www/command.luizrodrigues.com` (dono `www-data`), nginx aponta pra lá.
- **Bug real, achado só depois de "pronto" (Luiz reportou tela em branco)**: o build de produção do frontend não tinha `VITE_API_URL` definido, então caiu no default de dev (`http://localhost:3333/api`) — no celular de quem abre o app isso não existe, ficava preso em "Não consegui falar com o servidor" pra sempre (o `AuthGate` nunca conseguia nem checar `/auth/status`). Corrigido com `frontend/.env.production` (`VITE_API_URL=/api`, caminho relativo — funciona em qualquer domínio já que frontend e backend ficam no mesmo domínio via nginx) — commitado no repo (não é segredo, é só o modo de build). Confirmado no bundle servido: sem `localhost:3333`, com `/api` embutido certo.
- **`ecosystem.config.js` e nginx site editados de forma só-aditiva**: nova entrada `financial-hub` adicionada ao array de apps (backup do arquivo original guardado antes), `pm2 start --only financial-hub` (nunca `restart all` ou reiniciar o arquivo inteiro) — conferido depois que `aberto-cms`/`aberto-cms-staging`/`aberto-site-staging` continuaram rodando com o mesmo PID/uptime, sem nenhum restart.
- **Deploy automático (`git push` → atualiza sozinho) ainda não configurado pro Financial Hub** — o webhook existente é hardcoded pro `aberto-cms`. Fica como próximo passo (não bloqueante) generalizar o webhook ou criar um separado.
- **Branch em produção é `orcamento-real-import`, não `main`** — é onde está todo o trabalho recente (categorias, sync Pluggy, login, etc.); `main` está bem defasada. Mesclar via PR fica pra quando o Luiz quiser.

### Base de dados real subida pra produção (02/09)

Luiz já tinha aberto o app e configurado a senha real antes de eu subir os dados — não podia simplesmente copiar o `dev.db` por cima, ia apagar a senha dele.

- **Confusão própria, resolvida sem perda de dado**: `DATABASE_URL="file:./prod.db"` resolve relativo à pasta do `schema.prisma` (`backend/prisma/`) quando é a APLICAÇÃO rodando que abre a conexão — então o banco real sempre esteve em `backend/prisma/prod.db`. Eu, verificando por fora, chequei `backend/prod.db` (sem a pasta `prisma/`) — um caminho que não existia, e o próprio `sqlite3` CLI criou um arquivo vazio ali só de tentar abrir. Pareceu que o banco tinha sumido; na real nunca existiu nesse caminho. Confirmado via `/proc/<pid>/fd/` (o processo rodando tinha o arquivo certo aberto o tempo todo) antes de mexer em qualquer coisa.
- **Preservado o `AppAuth` real** ao subir os dados: parei o processo, fiz backup do `prod.db` real, copiei o `dev.db` local por cima, depois `ATTACH DATABASE` no backup pra reinserir só as tabelas `AppAuth`/`WebauthnCredential` de volta (a senha que o Luiz já tinha configurado) — nunca vi o hash da senha dele em texto explorável, só usei `ATTACH`+`INSERT SELECT` pra mover a linha inteira entre bancos.
- Confirmado depois do restart: `hasPinConfigured: true` intacto, 419 transações e 111 categorias reais batendo com o local. Backup temporário apagado depois de confirmar.

### Módulo Projetos (02/09): freela integrado ao Command OS

Luiz definiu Projetos como "o único lugar que vou subir manualmente cada novo projeto" — a entrada de dinheiro de freelance que alimenta o resto do Command. Fonte de verdade: planilha real do Google Sheets ("PLANEJAMENTO - 2026"), já organizada e com dados reais (8 clientes, 22 projetos, 21 recebimentos, 1 fornecedor). Schema (`Client`/`Project`/`ProjectReceipt`/`TaxPayment`/`Supplier`/`ProjectSupplierCost`/`SupplierPayment`) e as FKs de ponte em `Transaction` (`projectReceiptId`/`taxPaymentId`/`supplierPaymentId`) já existiam de uma sessão anterior — faltava toda a lógica e a UI.

- **Regra de imposto (a parte não-óbvia)**: cliente nacional paga DAS fixo de 6% (calculado ao vivo, não precisa de registro). Cliente do exterior ("gringa") tem DAS **variável**, só sabido quando chega o boleto real — a planilha assumia 6% pra todo mundo, mas Luiz confirmou que está errado (ex: 3,4% da última vez). Por isso `Client.isForeign` marca os 3 clientes estrangeiros (HKEK, PICKLEBALL FORUM, SOILYTIX). Um `TaxPayment` (`competenceMonth`/`Year`, `totalRevenue`, `amountPaid`, `paymentDate`) é rateado proporcionalmente entre os projetos que faturaram naquele mês pela participação de cada um na receita — testado ao vivo: R$3.107,00 de DAS em maio/2026 (receita real R$91.393,00) dividiu certinho entre os 4 recebimentos da HKEK daquele mês (R$973,31 + R$938,43 + R$798,87 + R$396,39 = R$3.107,00 exato). **Revisado em 02/09 (2ª rodada)**: a versão inicial deixava `taxAmount`/`net` em `null` ("a definir") pra mês/parcela sem DAS real ainda — Luiz pediu pra mudar: "usa a base que temos, depois atualizamos". Agora `computeProjectTax` sempre resolve um número, usando 6% como estimativa (mesma base do nacional) pra qualquer parte do contrato sem DAS real cobrindo o mês (incluindo o que ainda não foi recebido) — e atualiza sozinho pro valor real assim que o boleto daquele mês é lançado. Um flag `taxEstimated`/`hasEstimatedTax` marca quando o número é chute, sem travar a tela.
- **Confirmado de novo**: sem Prolabore/Caixa (60/40) — Luiz já tinha dito antes que nunca usou isso, todo líquido vira dinheiro pessoal direto (ver decisão de 25/08 acima).
- **Bridge com o resto do Command**: cada recebimento (`ProjectReceipt`) e pagamento a fornecedor (`SupplierPayment`) cria uma `Transaction` de verdade (entrada/saída) na hora, categorizada em `Projetos > {Cliente}` (entrada) ou `Empresa > Fornecedores`/`Imposto` (saída) — categorias criadas sob demanda, reaproveitando o CRUD de categorias já existente. Deletar o recebimento/pagamento remove a `Transaction` ligada também — testado (criar recebimento de R$1,00, confirmar na tela, apagar, confirmar 0 órfão no banco).
- **Projeto "finalizado" é derivado, não um campo**: só é finalizado quando o total recebido bate o valor do contrato (ou já foi cancelado não conta). Bug pego em teste ao vivo antes de declarar pronto: o filtro de "projetos ativos" no resumo (`/projects-summary`) usava só o campo bruto `status === "em_andamento"`, então todos os 22 projetos importados apareciam como "ativos" mesmo com 16 já finalizados de verdade — corrigido pra usar a mesma lógica derivada (recebido < valor do contrato) usada em todo o resto do endpoint. Confirmado por curl: contagem caiu de 22 pra 6, batendo com `openCount`.
- **Frontend** (`pages/Projetos.tsx`, nova, substitui o `PlaceholderPage` — removido do projeto): 3 seções — Visão Geral (4 caixas de estatística espelhando a aba da planilha: receita bruta/líquida, imposto pago, fornecedor pago/a pagar, recebido/a receber, dias trabalhados, finalizados/em aberto, + gráfico de pizza "ganhos totais por cliente"), Projetos (lista expansível com status, criação com "+ Novo cliente" inline, detalhe com recebimentos e fornecedores por projeto, cada um com formulário inline de adicionar), Impostos/DAS (tabela + formulário com preview ao vivo do faturamento do mês antes de registrar o pagamento).
- **Verificado ponta a ponta com dados reais** (não só a importação): todos os números da API batem exatos com a planilha (receita bruta R$246.972,48, a receber R$60.150,00, dias trabalhados 642, 16 finalizados/6 em aberto, contrato de cada um dos 8 clientes) — e testado ao vivo no navegador: criar/apagar recebimento, registrar DAS com rateio correto, criar projeto novo, adicionar fornecedor a um projeto — tudo com dado de teste descartável, removido do banco antes de terminar (0 resíduo).

### Projetos, 2ª rodada de ajustes (02/09): feedback de uso real

Depois de usar a tela pela primeira vez, Luiz voltou com 8 pontos — a maioria "isso não dá pra ver"/"como eu faço X" típico de quem realmente usou, não just polimento cosmético:

- **Imposto "a definir" virou estimativa (ver bullet revisado acima)** — não trava mais em `null`.
- **Rendimento/dia já é projeção, não realizado**: Luiz perguntou "se eu tenho o valor e a data pro projeto, logo eu sei quanto terei de rendimento no dia certo?" — resposta é sim, e o cálculo já fazia isso certo desde o início (`net` sempre foi contra o `contractValue` inteiro, não o `received`); só não aparecia pros projetos estrangeiros porque `taxAmount` ficava `null`. Resolvido de graça pelo fix do imposto acima — nenhuma mudança extra precisou nesse cálculo.
- **Lista de projetos**: nome do cliente agora aparece em destaque (era o nome do projeto que aparecia primeiro, e "não consigo visualizar do que se trata" — o cliente é a informação que identifica o projeto de relance). Projeto finalizado fica com opacidade reduzida (`.cardFinalizado`, opacity 0.55) e a ordenação (`/projects`, backend) põe todo finalizado no fim da lista, mantendo mais recente primeiro dentro de cada grupo.
- **Modais em vez de formulário inline no accordion**: "Novo recebimento", "Novo fornecedor no projeto" e "Pagamento — {fornecedor}" viraram popups (mesmo padrão visual do `ManualPositionsModal` — overlay + sheet), abertos por um botão claro (`+ Adicionar`, `+ Adicionar fornecedor`, `+ Pagamento`) em vez do formulário sempre visível dentro do card expandido. Resolve de quebra a pergunta "como eu adiciono o pagamento pro fornecedor?" — o botão já existia mas ficava perdido misturado com o resto dos campos do fornecedor; virando modal com título próprio ("Pagamento — Fabio") ficou óbvio.
- **Gráfico de linhas "Recebido por mês"**: reaproveitado o mesmo `SmoothLineChart` que Dashboard/Patrimônio já usam, com o `monthlyReceived` que a API já calculava (só não estava plotado na própria página de Projetos).
- **Box "Outros" renomeado pra "Resumo"**: Luiz achou o nome "Outros" sem sentido pro que aquele card mostrava (média mensal, dias trabalhados, finalizados/em aberto) — virou "Resumo" e ganhou o gráfico de linhas dentro dele.
- **"Total de entradas" ganhou imposto previsto vs. pago real**: antes só mostrava receita bruta/líquida. Agora mostra também `taxEstimatedTotal` (soma do imposto de todos os projetos não cancelados, na mesma base estimada/real do item acima) e `taxPaidTotal` (soma de todo `TaxPayment.amountPaid` já lançado — é o mesmo número que vira `Transaction` na categoria "Imposto" do Orçamento, então bate com o que Luiz vê lá).
- Todos os 8 itens testados ao vivo no navegador com dado descartável (recebimento, fornecedor e pagamento de teste no projeto MODAL) — removido do banco antes de terminar, 0 resíduo confirmado por SQL.
- **Deploy em produção** (mesma sessão): `git pull` + `prisma migrate deploy` + `prisma generate` + `npm run build` (backend com Node 20, frontend com Node 22) + `rsync` do `dist` pra `/var/www/command.luizrodrigues.com` + `pm2 restart financial-hub` (só esse processo — os outros 3 do droplet mantiveram PID/uptime). Backup do `prod.db` feito antes da migração, apagado depois de confirmar 419 transações e o PIN (`AppAuth`) intactos.

### Instância de demonstração (02/09): demo.luizrodrigues.com, banco 100% fake

Luiz pediu um segundo "usuário" — senha 123456, vendo o Command funcionando de verdade mas com dado fake, sem risco nenhum pro banco real dele ("o meu vai permanecer intacto"). O app hoje é single-tenant (um banco só, um `AppAuth` só, singleton igual `WealthGoal`) — não dá pra simplesmente "adicionar uma senha nova" no mesmo banco, ela abriria pros dados reais. Solução: **instância separada** (mesmo código, banco/domínio/processo próprios), não multiusuário de verdade — mais rápido, e garante isolamento total (arquivos diferentes, não lógica de filtro que pode ter bug).

- **Infra**: subdomínio novo `demo.luizrodrigues.com` (CNAME criado pelo Luiz, mesmo padrão do `command`), nginx próprio (`sites-available/demo.luizrodrigues.com`, proxy pra porta 3334) + certbot (cert Let's Encrypt próprio). Segundo processo pm2 (`financial-hub-demo`) rodando o MESMO checkout de código (`/root/apps/financial-hub`), só que com env vars diferentes (`PORT=3334`, `DATABASE_URL=file:./demo.db`, `APP_ORIGIN`/`FRONTEND_URL` do domínio demo, `SESSION_SECRET` gerado à parte) — passadas direto no `ecosystem.config.js` (aditivo, nunca tocou nos outros 4 apps do droplet), não por um `.env` separado: dotenv só define uma env var se ela ainda não existir no processo, então o valor que o pm2 injeta sempre vence o do `.env` do backend real pra essa instância.
- **Segurança da chave Pluggy**: `PLUGGY_CLIENT_ID`/`PLUGGY_CLIENT_SECRET` do processo demo ficam **vazios de propósito** — se alguém clicar em "Sincronizar"/"Adicionar corretora" na demo, a chamada pra Pluggy falha (502 tratado, sem crash), em vez de usar sem querer a conta Pluggy real do Luiz. `services/scheduler.ts` também não faz nada na demo (só sincroniza `Broker` com `dataSource: "pluggy"`, e nenhum foi criado lá — só `manual_statement`).
- **Nome do greeting configurável**: "Bom dia/Boa tarde/Boa noite, Luiz" no `AppLayout.tsx` virou `VITE_DISPLAY_NAME` (default continua "Luiz" quando a env var não existe — build normal do app real não muda em nada). Frontend da demo buildado com `vite build --mode demo` (lê `.env.demo`, não `.env.production`) com `VITE_DISPLAY_NAME=Convidado` — dois builds distintos, mesma árvore de código, cada um com seu `.env` de modo.
- **Dado fake** (`tmp-import/seed-demo.cjs`, gitignored, mesmo padrão do `import-projects.cjs`): roda só em banco vazio (guarda de segurança própria no script — recusa rodar se já existir alguma `Transaction`). Cobre os 3 módulos: ~20 categorias + orçamento de 3 meses + ~100 transações de 5 meses (Orçamento), 2 corretoras fake + 5 ativos + 6 meses de posição + meta de patrimônio (Patrimônio), 5 clientes fake (2 estrangeiros) + 8 projetos + recebimentos + 1 fornecedor + 1 DAS real de cliente estrangeiro pra mostrar o rateio funcionando (Projetos) — tudo com nome/valor inventado, nada derivado do dado real do Luiz.
- **Verificado**: banco real (`prod.db`, 445 transações) e banco demo (`demo.db`, 98 transações fake) são arquivos totalmente separados, confirmado por SQL antes e depois; PIN 123456 criado via `POST /auth/setup` (o endpoint oficial, não inserção direta no banco) e testado ao vivo em `https://demo.luizrodrigues.com` — greeting "Boa noite, Convidado", Dashboard/Orçamento/Patrimônio/Projetos todos com dado fake coerente, zero erro de console. Script de seed e backup temporários apagados do servidor depois de confirmar.
- **Limitação conhecida, sem impacto real**: a categoria de cada transação fake é sorteada independente do nome do comerciante (ex: "iFood" pode cair em "Eletrônicos") — puramente estético, não afeta nenhum cálculo nem trava nenhuma tela.

### Projetos, 3ª rodada (02/09): design system + UX da lista

Depois de ver a tela de novo, Luiz voltou com 6 pontos de polimento visual/UX — o achado técnico principal: os formulários novos de Projetos quebravam uma regra do design system sem eu perceber.

- **Causa raiz do scroll horizontal nos modais**: `<Input>`/`<Select>` só participam direito de um `.formRow` (flex-wrap) quando têm a prop `label` — sem ela, o campo renderiza "nu" (sem o wrapper `.field` que dá `flex:1;min-width:160px`), e a regra `.input { width:100% }` vira `flex-basis:100%` do próprio campo — cada campo tentando ocupar a linha inteira sozinho. Todo o resto do app (Patrimônio, Orçamento) sempre usou `label` em formulário de verdade; os modais novos de Projetos usavam `placeholder` solto, quebrando essa regra sem querer. Corrigido em todos os campos (`NewProjectForm`, `AddReceiptModal`, `AddSupplierCostModal`, `AddSupplierPaymentModal`, `NewTaxPaymentForm`) — e o `<Select>` (que não aceitava `label`) ganhou a mesma prop do `<Input>`, componente de design system atualizado pra sempre, não só um remendo local. Modal também ganhou mais largura (480px → 560px) de folga. Testado: 3 campos lado a lado (Fornecedor + Nome + Valor) sem overflow, mesma altura, mesmo alinhamento — confirmado por medição direta de `getBoundingClientRect`, não só visual.
- **Botões "Adicionar" redesenhados**: eram um `.smallBtn` cinza solto embaixo da lista — viraram `.addBtnSmall` (mesma cor de destaque do `.addBtn` usado em "Novo projeto"/"Registrar DAS", só um pouco mais compacto) posicionados do lado direito do título da subseção ("Recebimentos"/"Fornecedores"), igual ao padrão já usado no resto do app. Espaçamento entre as duas subseções aumentado (`--space-4` → `--space-5`).
- **Pausar/Cancelar visível na lista, sem expandir**: header do card virou 2 linhas — linha 1 (cliente + status + ícones de ação, sempre visível), linha 2 (nome do projeto + datas à esquerda, valor à direita). Ação de pausar/cancelar virou ícone (`Pause`/`Play`/`Ban`, 24px, mesmo padrão do botão de excluir recebimento) em vez de botão de texto escondido dentro do card expandido — só aparece pra projeto ativo (em andamento/pausado; finalizado e cancelado não têm ação, corrigindo de quebra um bug pequeno onde "Pausar" aparecia até em projeto já cancelado). Cancelar ganhou confirmação (`confirm()`) — fica mais fácil de clicar sem querer agora que está sempre visível.
- **"Resumo" + "Total de entradas" mesclados num box só**, movido pro topo da Visão Geral — mesmo padrão de duas fileiras de `statGrid` + gráfico que o Dashboard já usa na própria seção de Projetos.
- **Entradas em Orçamento** (`Total de entradas do mês` novo, topo do grid): "quanto entrou" nunca aparecia na página de Orçamento (só olhava despesa) — agora mostra o total de receita real do mês (`Transaction` tipo income) + comparação com mês anterior + uma linha específica "dos quais R$X vieram de Projetos" (via `projectReceiptId`), fechando o ciclo que o módulo Projetos criou (recebimento de projeto sempre virou `Transaction` de entrada real — agora isso fica visível onde o dia a dia é acompanhado, não só em Projetos).
- Testado ao vivo: modal sem overflow horizontal confirmado por medição, pausar→retomar testado de ponta a ponta num projeto real e revertido ao estado original (sem alteração líquida), ícones de ação visíveis nos 6 projetos ativos sem expandir nenhum, "Entradas do mês" batendo exato com o recebido de agosto (R$10.250,00, 100% de Projetos naquele mês).

### Categorização automática: bug real achado respondendo uma pergunta (03/09)

Luiz perguntou "quando o sistema identifica uma nova compra no cartão, ele categoriza automático, ou eu sempre tenho que verificar?" — resposta curta: **parcialmente automático**. No sync (`pluggyTransactionSync.ts`), toda transação nova tenta resolver categoria por 2 fontes, nessa ordem: (1) a categoria que a própria Pluggy já manda (mapeada via `PLUGGY_CATEGORY_MAP`), (2) uma `CategorizationRule` cujo padrão bate com a descrição (`suggestCategory`). Só o que não bate em nenhuma das duas fica "sem categoria" e aparece no banner/modal de revisão — o resto entra categorizado sozinho, sem pedir confirmação.

- **Bug achado investigando pra responder a pergunta**: `reinforceRule()` (a função que "aprende" — grava/reforça uma `CategorizationRule` toda vez que o usuário confirma ou corrige uma categoria) **existia no código mas nunca era chamada em lugar nenhum**. Ou seja: categorizar manualmente "Uber" uma vez em "Revisar orçamento" não ensinava nada — na próxima compra da Uber, caía em "sem categoria" de novo, pra sempre, só ensinado pelas regras que já vieram pré-populadas da planilha original.
- **Corrigido**: `PUT /transactions/group` (revisão de transação real) e `PUT /upcoming-installments/group` (revisão de parcela futura) agora chamam `reinforceRule(descrição, categoryId)` antes de aplicar a categoria — usando a descrição crua (a mesma string que `suggestCategory` compara no sync). Confirmado o comportamento certo, com dado de teste descartável: categorizar uma transação nova cria a regra (confidence 0.5); categorizar de novo o mesmo comerciante reforça a mesma regra (confidence 0.5 → 0.55) em vez de duplicar. Dado de teste removido depois.
- Vale ressaltar: isso só ajuda a partir de agora — a categorização aprendida de um comerciante não é retroativa pras transações antigas dele que já ficaram "sem categoria" (mesma regra do `CATEGORIZATION_TRACKING_START`, 01/09).

### Projetos, 4ª rodada (03/09): modal de novo projeto + entradas visíveis

- **"Novo projeto" virou modal** — era um formulário sempre visível abaixo do header da seção "Projetos" (`${cards.card} ${styles.form}` solto na página); agora abre no mesmo `Modal` genérico já usado em recebimento/fornecedor/pagamento. Mudança mecânica (só trocou o wrapper, mesma lógica/campos) — confirmado sem overflow horizontal no modal com 3 campos (Cliente novo: nome + estrangeiro).
- **"Total de entradas" na Visão Geral**: só existia "Total de saídas" (imposto + fornecedor) — Luiz notou a falta do espelho do lado de entrada. Novo card ao lado mostra Recebido este mês (com seta de comparação vs. mês anterior, `MonthDelta`), Recebido no ano, Total a receber — esses dois últimos vieram do antigo card "Atual" (removido, o resto do seu conteúdo — fornecedor pago/a pagar — foi pra dentro de "Total de saídas", que ganhou "Total a pagar (fornecedor)" que também estava solto lá). Resultado: os dois cards ficaram espelhados (entradas de um lado, saídas do outro), sem card "Atual" ambíguo no meio.

### Passe de responsividade + espaçamento (04/09): o bug real por trás do scroll horizontal

Luiz mandou prints do app no celular apontando 5 problemas. O mais sério ("scroll horizontal no mobile") não era feeling, era um bug de CSS Grid raiz — vale registrar como foi achado porque o mesmo padrão pode voltar em qualquer card novo com tabela.

- **Causa raiz do scroll horizontal**: `.card` (usado em toda página como item de `.grid`, `display:grid`) não tinha `min-width: 0`. Um item de grid tem "tamanho mínimo automático" por padrão = o maior min-content de TUDO que tem dentro dele — mesmo coisas várias camadas abaixo. A tabela de "Comprometido em parcelas futuras" (Orçamento) tem `th` com `white-space: nowrap` e 5 colunas; mesmo estando dentro de um `.tableWrap` com `overflow-x: auto` próprio (que deveria isolar o scroll), o `overflow:auto` está no DESCENDENTE, não no item de grid direto (`.card`) — e só overflow no item de grid direto suprime esse tamanho mínimo automático. Resultado: a tabela empurrava a largura da coluna do grid inteira (~600px), e como cards full-width ocupam a coluna inteira, TODO card da página virava ~600px de largura numa tela de 375px, mesmo cards sem tabela nenhuma (confirmado isolando elemento por elemento via `display:none` + medir `scrollWidth`, não só olhando). Fix: `min-width: 0` no `.card` (cards.module.css) — item de design system, resolve pra qualquer card/tabela futura, não só esse caso.
- **Fontes menores no mobile**: `.heroValue` (2rem→1.5rem), `.statTileValue`, `.totalLabel` (valor da barra "Total do mês") e `.pageTitle` (Projetos/Patrimônio/Configurações) ganharam uma regra `@media (max-width: 480px)` reduzindo o tamanho — só os números/títulos grandes, não o texto de leitura normal.
- **Padding consistente em campo de formulário**: `.input`/`.select` (Input.module.css, usado em TODO campo do app) usava `padding: 0 var(--space-3)` (12px) enquanto os botões pill ao lado usam `var(--space-4)` (16px) — o campo sempre parecia mais "espremido" que o botão vizinho. Igualado pra `var(--space-4)`, e o gap entre label e campo (`.field`) foi de 4px pra 6px. Efeito colateral positivo: resolve sozinho a maior parte da sensação de "esmagado" nos modais, porque é o MESMO componente usado em todo formulário do app.
- **Accordion do Orçamento**: `.accordionHeader` tinha padding uniforme de 12px (a setinha ficava colada 12px depois da borda do card, mas o card já tem 24px de padding próprio — a soma dava só 12+24, parecia pouco perto do padding generoso do resto do app). Padding horizontal subiu pra 16px (`var(--space-4)`), e o indent do corpo do accordion (`.accordionBody`) recalculado pra continuar alinhado embaixo do nome da categoria.
- **Card de projeto reestruturado** (pedido específico): linha 1 agora é "Cliente • Projeto" à esquerda + status/pausar/excluir à direita (era "Cliente" sozinho na linha 1, nome do projeto tinha ido pra linha 2 na rodada anterior — Luiz pediu pra juntar os dois na mesma linha com "•"); linha 2 é só data à esquerda + valor à direita. O ícone de cancelar trocou de `Ban` (🚫) pra `Trash2` (lixeira) — mesmo ícone já usado pra remover recebimento, por consistência.
- **Recebimentos e Fornecedores em boxes cinza separados**: as duas listas dividiam o mesmo fundo branco do card, sem nenhuma fronteira visual — pareciam uma coisa só. Cada `.detailSection` agora tem fundo `var(--fill-muted)` (cinza claro) + padding próprio, com o gap de `var(--space-5)` entre as duas (já existente) criando a margem pedida. Dentro de Fornecedores, cada `.supplierBlock` (que também usava fill-muted) mudou pra `var(--surface)` (branco) + borda, pra contrastar com o novo fundo cinza do container em vez de se misturar nele.
- Testado ao vivo em viewport mobile real (375×812): `scrollWidth` medido em Dashboard/Orçamento/Patrimônio/Projetos (colapsado, expandido, com modal aberto) — todos ≤ 358px, sem scroll horizontal em lugar nenhum. Console sem erro. PIN de teste removido do banco ao final.

### 2 ajustes de acabamento (04/09): hierarquia "Cliente • Projeto" + padrão de caixa compacta

- **"Cliente • Projeto" ganhou hierarquia visual**: os dois vinham no mesmo tamanho/cor (`.projectName` pra tudo) — Luiz pediu pra deixar o nome do projeto menor e cinza, só o cliente em destaque. Virou 3 `<span>`s (`.projectName` pro cliente, `.projectNameSep` pro "•", `.projectNameSecondary` novo — 12,5px, `var(--ink-soft)`) dentro de um `.projectHeaderTitle` que é quem agora carrega o `flex:1;min-width:0`; o nome do projeto trunca com "..." se não couber, o cliente nunca trunca.
- **Padrão de caixa compacta definido**: `.totalRow` ("Total do mês" no Dashboard) tinha padding `var(--space-4)` (16px) e `border-radius: var(--r-lg)` (28px) — 28px de raio numa caixa de ~80px de altura ficava desproporcional (quase uma pílula), e o padding apertado dava a sensação de espremido. Novo padrão pra esse TIPO de elemento (destaque de valor único dentro de um card — diferente de tile de grid pequeno tipo `.statTile`, e diferente do `.card` em si): `border-radius: var(--r-sm)` (12px) + `padding: var(--space-5)` (24px, igual ao `.card`). Registrado aqui pra próxima caixa desse tipo replicar em vez de inventar um radius/padding novo.

### Bug real achado respondendo uma pergunta: transação presa numa data errada (04/09)

Luiz perguntou por que o pagamento da fatura BTG (R$3.769,98) não apareceu no gráfico de meta diária, "a mesma coisa com o mastercard". Investigação com dado real (não só a pergunta) — comparei as 427 transações reais de cartão (BTG + C6, via chamada direta e só-leitura na API da Pluggy) contra o que está gravado em produção.

- **Parte 1 (comportamento esperado)**: "Pagamento" de fatura é `isTransfer: true` de propósito — cada compra real que gerou a fatura já devia ter virado seu próprio lançamento na data real; contar o pagamento da fatura TAMBÉM como gasto duplicaria (uma vez na compra, outra no pagamento). Confirmado que C6/Mastercard segue exatamente o mesmo padrão ("Inclusao de Pagamento Ciclo Corrente"/"Pagamento recebido" também `isTransfer: true`).
- **Parte 2 (bug real, achado investigando a parte 1)**: a parcela de agosto da Usina Solar (BTG, R$3.847,10, `SolDistribuidoraMaringaBRA`) estava gravada com `date = 03/02/2026` — 6 meses errada — enquanto a Pluggy reporta ela (mesmo `externalId`) com `date = 22/08/2026` agora. Causa: nosso sync (`pluggyTransactionSync.ts`) só verifica se o `externalId` já existe e pula se sim — nunca ATUALIZA uma transação já sincronizada, mesmo que a Pluggy tenha corrigido a data dela depois (parece ter acontecido aqui: a Pluggy retornou essa parcela pela primeira vez com uma data provisória, ligada à data de conexão da conta — junto de mais ~17 parcelas antigas da mesma Usina Solar, todas empilhadas em 03/02, isso sim é limitação normal de backfill histórico da Pluggy, sem solução nossa —, e só corrigiu a data de verdade quando a parcela realmente aconteceu). Resultado prático: a parcela de agosto nunca apareceu no dia certo do gráfico de meta diária.
- **Auditoria completa, não só esse caso**: cruzei as 427 transações Pluggy reais (BTG 37 + C6 390) contra produção — **0 faltando no banco, 0 valor divergente, só essa 1 data divergente**. Caso isolado, não sistêmico; C6 (uso diário, 390 transações) 100% limpo.
- **Corrigido**: `UPDATE` direto em produção só nessa 1 linha (`date` de 03/02 pra 22/08), backup feito antes e apagado depois de confirmar. Nenhuma mudança de código — Luiz optou por corrigir só o caso pontual por enquanto, não mudar a lógica do sync pra auto-atualizar (ficaria como possível melhoria futura se o padrão se repetir).

### Ícone da tela de início do iPhone (04/09): raio grande demais + fundo preto

Luiz mandou print de como o ícone aparece na tela de início do iPhone — raio ocupando quase o ícone inteiro, fundo preto (devia ser branco). Causa: `icon-192.png`/`icon-512.png` (usados pelo manifest da PWA) tinham o raio ocupando quase 100% do canvas E com canal alfa (fundo transparente, não branco de verdade) — iOS preenche área transparente de ícone de tela de início com preto (comportamento conhecido do Safari/PWA no iOS, não é bug do nosso lado, mas dava pra evitar).

- **Recriado a partir do vetor original** (`favicon.svg`, com todos os gradientes/blur originais preservados): raio escalado pra ~44% do canvas (era quase 100%) e centralizado num fundo branco sólido.
- **Canal alfa removido de propósito** (não só pintado de branco por trás) — testado com `sips --getProperty hasAlpha`: o PNG exportado do `<canvas>` do navegador SEMPRE volta com alfa (`toDataURL('image/png')` não respeita `{alpha:false}` do contexto, confirmado tentando) — resolvido com um round-trip PNG→JPEG(qualidade 100)→PNG só pra achatar o canal alfa de vez, sem risco nenhum de o iOS voltar a preencher de preto por trás.
- **`apple-touch-icon` explícito** adicionado no `index.html` (apontando pro `icon-192.png` novo) — reforço pra iOS mais antigo que não lê o `icons` do manifest, só esse link específico.
- Gerado via `<canvas>` no próprio navegador (sem precisar instalar rsvg-convert/ImageMagick/Pillow no ambiente) — servidor HTTP local descartável em `/tmp` só pra servir o SVG intermediário, tudo apagado depois.

### Tarifa que sempre se anula + vencimento de parcela sempre errado (04/09)

Dois ajustes pedidos juntos, os dois em `pluggyTransactionSync.ts`.

- **"Tarifa Anuidade Diferenciada" (C6)**: cobrada e estornada todo mês (R$98 cada lado) por causa do investimento do Luiz no C6 — sempre se anula, nunca deveria contar como gasto. O ESTORNO já vinha certo (`isTransfer: true`, CREDIT); a COBRANÇA (DEBIT) não — contava como gasto real todo mês há 13 meses (desde set/2025). Adicionado `isSelfCancelingCharge()` — lista de descrição conhecida que força `isTransfer: true` mesmo sendo DEBIT (documentado como padrão extensível, pra outra tarifa igual que aparecer no futuro). Retroativo: as 13 cobranças já existentes viraram `isTransfer: true` direto em produção.
- **Vencimento de parcela futura sempre no dia 1**: `futureDueDate()` sempre devolvia dia 1 do mês, não importa a compra — "Comprometido em parcelas futuras" mostrava toda parcela vencendo no mesmo dia, claramente errado (print do Luiz: Usina Solar, Academia, Amazon, tudo "01/09/2026"). Corrigido pra usar o dia real da parcela mais recente já cobrada como âncora (ex: Usina Solar sempre vence perto do dia 22, Academia Korpus/Amazon/77Tramo do C6 sempre por volta do dia 15 — confirmado com 4 compras reais diferentes, todas no C6, estabilizando no dia 15 depois do 1º/2º mês: é o dia de fechamento daquele cartão, não coincidência) — com `lastDayOfMonth()` clampando (dia 31 num mês de 30 não estoura pro mês seguinte).
- **Retroativo, via API real da Pluggy (só leitura) pras 68 linhas de `UpcomingInstallment` sincronizadas via Pluggy** (as outras ~146 vêm do import manual antigo, fora do escopo desse fix): pra cada uma, buscou a parcela mais recente REAL daquela compra (por descrição, pegando a de data mais recente — não o `installmentNumber`, que no lote de backfill histórico pode vir sem relação com a ordem cronológica de verdade) e comparou o mês/ano da linha salva contra o mês/ano dessa parcela real. **26 linhas apagadas** (mês já coberto por uma `Transaction` real — ficariam contando dobrado se continuassem como "futura"), **42 linhas com a data corrigida** pro dia certo. Testado primeiro em modo simulação (nada alterado, só o relatório) antes de aplicar de verdade; backup feito e apagado depois de confirmar.

### Reconciliação de transação "PENDING" (04/09): mesmo bug de novo, terceira vez

Luiz perguntou por que uma compra do Google Workspace (01/09, C6) não aparecia — achei ela lá, só que com o nome "MASTERCARD INTERNACIONAL" (nome genérico que o Mastercard manda pra compra internacional enquanto o banco não confirma o lojista real). Mesma causa-raiz das duas rodadas anteriores (data da parcela BTG, tarifa do C6): **nosso sync nunca revisita uma transação já sincronizada**, mesmo que a Pluggy corrija o dado dela depois — dessa vez não foi a data, foi a descrição (PENDING → POSTED).

Como já eram 3 ocorrências da mesma classe de bug, dessa vez construímos a correção geral (a pedido do Luiz) em vez de outro remendo pontual:

- **`Transaction.pluggyPending`** (schema novo, migração `20260904150000_transaction_pluggy_pending`): `true` quando a Pluggy retornou aquela transação como `status: "PENDING"`. Enquanto `true`, o PRÓXIMO sync confere se já virou `"POSTED"` — se sim, atualiza `description`/`amount`/`date`/`isTransfer` pro dado real e marca `pluggyPending: false`. Uma transação já `false` NUNCA é tocada de novo (evita reabrir algo que o usuário já confirmou/corrigiu à mão).
- **Achado testando (bug do próprio fix, pego antes de ir pra produção)**: a primeira versão resolvia `categoryId` de novo na reconciliação e SOBRESCREVIA categoria já definida — testei com a Google Workspace de agosto (categorizada à mão como "Gmail", categoria própria do Luiz) e a reconciliação apagou essa categoria, substituindo por `null`. Corrigido: só resolve categoria nova se `existing.categoryId` for `null` — categoria já definida (auto ou manual) nunca é sobrescrita.
- **Testado com dado real** (não simulado): marquei uma transação real já confirmada (Google Workspace de agosto, `status` real na Pluggy = `POSTED`) como `pluggyPending: true` de propósito, rodei o sync de verdade — reconciliou certo (nome + categoria preservada) na primeira tentativa boa. Uma tentativa anterior com outra transação (99 Ride de 27/08) não reconciliou porque ela **ainda está `PENDING` de verdade na Pluggy** mesmo dias depois — confirma que o sync não força nada, só reconcilia quando a Pluggy realmente já confirmou.
- Retroativo: as 2 transações de 01/09 já achadas (R$7 e R$1,34) corrigidas direto em produção antes desse fix de código existir.
- `transactionsReconciled` novo no retorno do sync — aparece no alerta de "Atualizar transações" (Orçamento) e no log do scheduler automático.

### "Comprometido em parcelas futuras" acumulava mês futuro junto (04/09)

Luiz notou que a tabela detalhada (Vencimento/Descrição/Cartão/Categoria/Valor) parava de mostrar parcela no meio do próprio mês. Primeira tentativa (errada): achei que era o `.slice(0, 20)` que cortava a renderização e removi — só que aí Luiz explicou o que realmente queria: **o card inteiro deveria mostrar só o mês navegado** (setembro só setembro, outubro só outubro), não a lista acumulada de todo mês futuro junto — é assim que todo o resto do Orçamento já funciona (categorias, "Total do mês", etc.), só esse card que era "a partir de", não "só esse mês".

- **Fix de verdade**: `GET /upcoming-installments` mudou o filtro de `dueDate: { gte: monthStart }` (acumulativo, pra sempre crescendo) pra `dueDate: { gte: monthStart, lt: monthEnd }` (só o mês exato navegado).
- **Efeito colateral (revertido a seguir)**: como o mês navegado da própria página já bate 1:1 com o card, achei o carrossel "Por mês" redundante e removi (junto com o cálculo de `byMonth` no backend e o tipo no frontend). Luiz corrigiu: ele queria continuar podendo clicar em outubro/novembro pra ver o compromisso daquele mês **sem sair do mês que está navegando na página** (Cartões, categorias, gráfico diário continuam no mês atual) — o carrossel não era redundante, era um atalho mais rápido que trocar de mês na página inteira.
- **Fix final**: `byMonth` voltou no backend, mas mudou de escopo — antes era calculado a partir do `month`/`year` da query (por isso virou "sempre 1 item" quando escopamos a lista principal); agora é **sempre todo mês futuro com parcela pendente**, independente do `month`/`year` pedido, então o carrossel sempre mostra todos os meses com compromisso, não só o navegado. No frontend, clicar num chip do carrossel dispara uma busca separada (`installmentMonth`/`installmentDetail`, estado próprio) que troca só a tabela/total/"por cartão" desse card — o resto da página (inclusive o mês oficial navegado no topo do Orçamento) não muda. Clicar de novo no mês que já é o navegado da página limpa a seleção e volta a seguir o mês da página automaticamente.
- Testado localmente: setembro mostrou 55 parcelas (R$11.703,67), outubro 39 parcelas (R$9.888,39) — bate com o que já aparecia antes; com a página em setembro, clicar no chip de outubro no carrossel mostra as 39 parcelas de outubro sem mexer em Cartões/categorias/gráfico (que continuam mostrando setembro).

### Coluna "Parcela" (N de Total) na tabela de parcelas futuras (04/09)

Luiz pediu pra saber, em cada linha da tabela "Comprometido em parcelas futuras", qual parcela é (ex: "parcela 6 de 10") — não só o valor e o vencimento. Achado sem precisar de coluna nova no banco: `UpcomingInstallment.externalId` de linha vinda do sync real da Pluggy já é `pluggy:<id da transação original>:<N>` (`pluggyTransactionSync.ts`), então **N já tá no próprio id**. O TOTAL também dá pra descobrir sem dado novo: o sync sempre cria uma linha pra CADA parcela restante até a ÚLTIMA (o loop é `for (n = current+1; n <= total; n++)`, nunca para no meio) e nunca apaga linha antiga (só de propósito, no fluxo de duplicata) — então o maior N já visto pra aquela transação-mãe, considerando TODAS as linhas dela (passadas e futuras), é sempre o total real.

- `GET /upcoming-installments`: nova query paralela (`select: { externalId: true }`, sem filtro de mês/data — precisa de toda linha já criada, não só as do mês da tela) monta um `Map<purchaseId, maxN>`; cada parcela da resposta ganha `installmentNumber` (o N do próprio id) e `totalInstallments` (o max daquele grupo). `null`/`null` pra parcela importada da planilha (sem esse formato de id).
- Verificado com 2 compras reais contra a Pluggy AO VIVO (não só contra o que já tava no nosso banco): "SolDistribuidoraMaringaBRA" (Usina Solar, BTG) — nosso cálculo deu total=21 batendo exatamente com `creditCardMetadata.totalInstallments: 21` da Pluggy; "DL\*BOOKINGCOM409" (C6) — total=7 batendo com `totalInstallments: 7` da Pluggy. Confirma que o dado já salvo no banco é suficiente, sem precisar reconsultar nada.
- Frontend: nova coluna "Parcela" na tabela (entre Descrição e Cartão), mostra `N/total` ou "—" quando não tem essa info (parcela de planilha).

### Carrossel "Por mês" gigante (bug do Chromium: grid `auto-fill` dentro de item flex) (04/09)

Luiz mandou print: o carrossel "Por mês" (recém-devolvido) tava ocupando ~700px de altura, com os chips flutuando bem no meio de um espaço vazio enorme. Reproduzido isolado (página estática com as CSS reais do projeto, fora da Pluggy/auth) pra achar a causa sem depender de login em produção — e reproduziu exatamente o bug à primeira tentativa.

- **Causa raiz**: `.items` (o grid dos chips dentro do carrossel) é filho de um flex container (`.row`) com `flex: 1` e usa `grid-template-columns: repeat(auto-fill, minmax(140px, 1fr))`. Isso é um bug conhecido do Chromium — pra descobrir quantas colunas cabem, `auto-fill` precisa de uma largura definida; mas durante o cálculo do tamanho intrínseco de um item flex, o navegador testa com largura indefinida/zero, então `auto-fill` resolve pra **1 coluna só** (mínimo permitido pela spec) — empilhando as 6 chips em 6 LINHAS uma embaixo da outra (6 × 48,5px + 5 gaps de 8px = exatamente 331px, o número batido na investigação). Essa altura errada "vaza" pro `.row` inteiro, mesmo o grid depois renderizando visualmente em 6 colunas de verdade (com a largura final já resolvida) — o valor da altura já ficou congelado errado.
- **Confirmado isolando variável por variável** (via `getComputedStyle`/`getBoundingClientRect` em página de teste): trocar só o `grid-template-columns` de `auto-fill` pra uma lista fixa de colunas (`repeat(6, minmax(140px,1fr))`) resolve sozinho — nada mais (align-items, flex-basis, wrapper extra) tinha efeito.
- **Fix**: como o `Carousel` já sabe quantos itens mostrar por vez (`perPage`), `Carousel.tsx` agora passa `grid-template-columns: repeat(${perPage}, minmax(140px, 1fr))` **inline** (calculado em JS, não mais fixo no CSS module) — resolve pra qualquer carrossel futuro que reusar o componente, não só esse caso. O `auto-fill` que ficou no `.module.css` virou só um fallback (nunca deveria ser usado de verdade, já que o inline sempre aplica).

### 25 parcelas duplicadas do Caixa (planilha × fatura real) removidas (04/09)

Luiz notou pelos prints (comparando a tela do app com a fatura real da Caixa em PDF) que várias compras parceladas apareciam duas vezes — uma com nome amigável ("quadro not basquiat x9") e outra com o nome cru do lançamento ("A G GRAFICA LTDA"). Investigado por `createdAt`: existem 3 lotes de importação bem distintos no banco — 29/08 20:15 (`batch A`: 16 C6 + 30 Caixa, da planilha antiga geral), 29/08 21:05 (`batch B`: 100 Caixa, extraído da fatura REAL — os nomes crus tipo "AMAZONMKTPLC HEIMONLTD"), e 01/09 14:20 (`batch C`: 15 BTG + 27 C6, do fix retroativo de data de vencimento já documentado acima). O `batch B` nunca substituiu/apagou o `batch A` depois de importado — ficaram os dois juntos.

- **Achado por join exato** (mesmo `dueDate` + mesmo `cardLabel="Caixa"` + valor batendo na casa de centavos, `batch A` × `batch B`): **25 pares** confirmados 1:1 (airbnb, compras casa, luminárias, amazon whey, reforma casa, quadro/A G Grafica). Sobraram **5 linhas do `batch A`** sem par (compras casa x6/x8/x9 e passagens mae x6/x7, valores diferentes de qualquer linha do `batch B`) — não mexido, sem confirmação de duplicata não apaga.
- **C6/BTG conferidos também**: nenhuma duplicata — o C6 tem 16 linhas só-da-planilha sem par ainda na Pluggy (não é duplicata, é parcela que a Pluggy ainda não confirmou como transação real; ficam como estão).
- **Fix aplicado** (backup do `prod.db` antes, apagado depois de confirmar): nas 21 linhas sobreviventes do `batch B` sem nota ainda, copiei o nome amigável da planilha pro campo `note` (ex: "Compras casa", "Luminárias", "Airbnb Recife") — as 4 "quadro"/A G Grafica já tinham nota "Quadros" antes, não mexi. Depois, apaguei as 25 linhas do `batch A` confirmadas como duplicata. Verificado por SQL direto: Caixa foi de 130 → 105 linhas, C6 (43) e BTG (15) intactos.
- **Sobre setembro** (dúvida do Luiz, olhando só a fatura de agosto no print): o `batch B` já importou o cronograma INTEIRO de cada compra, não só o mês da fatura fotografada — conferido no caso "A G Grafica/Quadros": já tinha linha pra set/out/nov/dez-26 e jan/27 antes mesmo desse fix. Não precisa acrescentar nada manualmente mês a mês.
- **Limitação que fica**: como o Caixa não é conectado via Pluggy (só C6/BTG/99/Sofisa são — confirmado na tabela `Broker`), esse cronograma do Caixa é uma FOTO estática de quando foi importado — não se atualiza sozinho. Uma parcela nova no Caixa (compra feita depois dessa importação) só entra se alguém importar de novo.

### "Revisar parcelas" — campo de total de parcelas virou editável (04/09)

Luiz pediu pra corrigir a modal "Revisar parcelas" e "deixar o campo de parcelas em aberto" pra ele mesmo corrigir o que falta — a coluna "Parcelas" ali só mostrava `{count}x` (quantas linhas restam, sempre correto, vem direto da contagem de linhas no banco) mas não dava pra editar o TOTAL da compra (a mesma informação nova que a "Comprometido em parcelas futuras" passou a mostrar como "N de Total"). Pra planilha antiga (sem `externalId` da Pluggy) ou pro raro caso do automático errar, não tinha como o Luiz corrigir esse total manualmente.

- `UpcomingInstallment.totalInstallments Int?` novo (migração `20260904200000_installment_total_override`) — override MANUAL, null por padrão (usa o automático). Aplicado em bloco pra TODAS as parcelas restantes da mesma compra de uma vez (mesmo padrão de `cardLabel`/`categoryId`/`amount` já existentes no PUT de grupo) — nunca uma linha isolada.
- Resolução em cascata (`resolveTotalInstallments`, `budget.ts`): override manual, se setado, sempre vence; senão cai pro automático (maior N do `externalId`, ver seção anterior). Vale tanto na tabela "Comprometido em parcelas futuras" quanto na própria modal "Revisar parcelas" — as duas mostram o mesmo número.
- Modal: coluna "Parcelas" virou "Total parcelas" — campo numérico editável (mostra o valor atual, automático ou manual) + "Nx restante(s)" como texto de apoio embaixo (isso continua só leitura, é a contagem real de linhas, não faz sentido "corrigir" sem adicionar/remover parcela de verdade). Limpar o campo (deixar vazio) remove o override e volta a usar o cálculo automático.

### "Parcela N" do Caixa não aparecia + totais preenchidos com dado real da fatura (04/09)

Luiz reparou que VANS LAPI e Riachuelo (Caixa) não mostravam "N de Total" mesmo depois do fix anterior — o motivo: o cálculo do `installmentNumber` só olhava o `externalId` (só existe pra parcela vinda da Pluggy), e o Caixa não é conectado via Pluggy, então nunca ia ter isso, mesmo colocando o total manual na modal.

- **Fix de verdade**: troquei o cálculo de posição pra funcionar com QUALQUER origem. Nova `buildInstallmentPositions()` agrupa as parcelas restantes da mesma compra (mesma chave do `/groups`) e conta de trás pra frente a partir do TOTAL (que pode ser manual OU automático via `externalId`): a linha de vencimento mais distante = parcela `total`, a anterior = `total - 1`, etc — como as parcelas restantes são sempre meses consecutivos até a última, isso dá a posição de CADA linha sem precisar de `externalId` nenhum. Funciona idêntico pro caso Pluggy (dá o mesmo resultado de antes) e agora também pro Caixa, bastando saber o total.
- **Preenchi os totais reais do Caixa direto** (sem esperar o Luiz digitar um por um na modal): usei os dados exatos dos 4 prints de fatura que ele mandou (28 compras diferentes, "N DE M" de cada uma) e cruzei por descrição+valor EXATOS contra o banco antes de aplicar — todos os 28 bateram sem ambiguidade (nenhum valor duplicado entre compras diferentes) e a contagem de parcelas restantes no banco sempre ficou ≤ o total da fatura (confirma que os matches fazem sentido). Aplicado via `totalInstallments` (mesmo campo/mecanismo da modal), backup do `prod.db` antes, apagado depois de confirmar. 100 das 105 parcelas do Caixa ficaram com total conhecido agora (as 5 sem par da limpeza de duplicata anterior continuam sem, ninguém confirmou o total delas ainda).
- Conferido com os 2 exemplos que o Luiz apontou: VANS LAPI (total=6) mostra 3/6 em set/26, 4/6 out/26, 5/6 nov/26, 6/6 dez/26 — bate exato com "03 DE 06" da fatura. Riachuelo (total=3) mostra 3/3 (última parcela) — bate com "03 DE 03".

### Mais 3 correções pontuais de parcela (planilha × real, C6) (04/09)

Luiz apontou mais 3 casos específicos de parcela da planilha (C6) que não batiam com a fatura real:

- **Tramontina (R$237,53)**: a planilha tinha somado 2 lançamentos reais em 1 só. A compra de verdade é "77TRAMO\*LOJAOFICIAL" (R$229,74, já rastreada certinho pelo sync automático da Pluggy — `total=10` confirmado ao vivo) **+** "76TRAMO\*LOJAOFICIAL" (R$7,79) que é uma cobrança recorrente normal (aparece todo mês como transação comum desde fevereiro, não é parcela de compra parcelada, não precisa de projeção futura). Apagadas as 3 linhas da planilha (`tramontina x8/x9/x10`) — a parte que importa já tinha tracking real.
- **Gel corrida (R$31,48)**: confirmado 1:1 (mesma data, mesmo valor arredondado) com "AMAZONMKTPLC ABASTEKLI" — a planilha errou o CARTÃO (falou C6, mas na real é Caixa). Já tinha sido resolvido pelo fix anterior (total=4 setado no Caixa); só faltava apagar as 2 linhas órfãs do C6 (`gel corrida x3/x4`).
- **Bike (R$1.159,00, "PEOPLE BIKE SHOP")**: caso diferente dos outros dois — conferido ao vivo na Pluggy, a compra real tem `totalInstallments: 10`, 2 parcelas já pagas (jul/26), **mas nenhuma das duas transações reais carrega `billForecastDate`** (campo que o sync usa pra projetar as parcelas futuras — `pluggyTransactionSync.ts` pula a projeção sem ele: `if (!forecast || total <= current) continue`). Resultado: essa compra real de R$1.159/mês (mais 8 parcelas até 2027) **não tem NENHUM tracking automático** — não é bug nosso, é a Pluggy não mandando o forecast pra essa compra específica. Decisão: não apaguei as linhas da planilha (perderia a única visão que existe desse compromisso) — só corrigi a identificação (`description` → "PEOPLE BIKE SHOP", `note` → "Bike") pra bater com o nome real, mantendo o calendário que já existia.
- **Pendência nova**: quando/se a Pluggy passar a mandar `billForecastDate` pra essa compra (normalmente quando a parcela 3 fechar fatura), o sync vai criar as linhas reais (`externalId` "pluggy:...") — nesse momento as 4 linhas manuais "PEOPLE BIKE SHOP" (sem `externalId`) viram duplicata e precisam ser apagadas manualmente (mesmo padrão dos outros casos desta sessão). Vale sempre desconfiar de parcela sem `externalId` que "nunca" ganha match automático — pode ser exatamente essa lacuna (falta de `billForecastDate` na Pluggy).
- **Capacete (R$34,03) — mesmo caso do bike**: Luiz apontou depois. Compra real é "MERCADOLIVRE\*MERCADOL" (C6, 22/07), conferido ao vivo: `totalInstallments: 5`, `installmentNumber: 1`, sem `billForecastDate` de novo — mesma lacuna do bike. As 3 linhas da planilha (`capacete x3/x4/x5`, set/out/nov) já batiam certinho com a cadência mensal esperada (parcelas 3, 4 e 5 de um total de 5, a partir da compra em julho) — só renomeadas (`description` → "MERCADOLIVRE\*MERCADOL", `note` → "Capacete"), mesma pendência de apagar quando a Pluggy sincronizar de verdade.
- **Tokstok (R$387,79) — variante do mesmo problema, causa um pouco diferente**: compra real "TOKSTOK TOKSTOK-629857" (C6), `totalInstallments: 10`, já com 6 parcelas postadas (mar-jul/26). A PRIMEIRA transação (mar/26) até tinha `billForecastDate` — mas nenhuma linha de `UpcomingInstallment` foi criada mesmo assim, porque na época (março) o recurso de projeção de parcela futura ainda nem existia no código; quando o recurso foi criado, essa transação já era antiga (não é `newlyCreated` em nenhum sync desde então, e a versão mais recente dela — parcela 6, jul/26 — não carrega mais `billForecastDate`, então nunca mais vai ser reprocessada). Resultado prático idêntico ao bike/capacete: sem tracking automático. As 3 linhas da planilha (`tokstok x8/x9/x10`) já batiam com a cadência esperada (parcelas 8, 9 e 10 de 10) — só renomeadas pro nome real, mesma pendência.

### Google Workspace/Gmail de setembro categorizado errado (04/09)

Luiz reparou que a categoria "Gmail" mostrava R$0,00 gasto no Orçamento, mesmo já tendo confirmado que as 2 transações de setembro (R$7,00 + R$1,34) já estavam postadas e não pendentes. Investigado: as transações realmente JÁ estavam lançadas — só que categorizadas como **"Encargos de Cartão"**, não "Gmail" (maio a agosto, todas corretas como "Gmail"; só setembro saiu errado). Não é falha do sync nem do cálculo do Orçamento — é a transação estar na categoria errada, então a soma da categoria "Gmail" mesmo estava certa (R$0,00 ali), só que o gasto foi parar em outro lugar.

- Não achei nenhuma regra de `CategorizationRule` nem mapeamento de código que explicasse "Encargos de Cartão" pra essa descrição (`resolveCategoryId`/`suggestCategory` não geram esse resultado pra "GOOGLE WORKSPACE..." — não tem regra cadastrada pra esse padrão, teria voltado `null`). Ou seja: TODO mês até agora a categorização de "Gmail" nessa transação era feita à mão pelo Luiz (não existia regra reforçada) — setembro só foi a vez que saiu errado (correção manual provavelmente equivocada, ou clique errado).
- **Fix**: `Transaction.categoryId` das 2 linhas de setembro corrigido pra "Gmail" direto no banco (backup/verify/cleanup de praxe). Além disso, criada uma `CategorizationRule` nova (pattern `"WORKSPACE_LUIZ"`, confidence 0.5, categoria Gmail) — cobre as duas variações de descrição já vistas ("GOOGLE WORKSPACE_LUIZR..." e "GOOGLE \*WORKSPACE_LUIZ...", ambas contêm esse substring) — daqui pra frente o sync já categoriza sozinho, sem precisar de correção manual todo mês.

## Pendências (não travadas ainda)

- [ ] `TaxPayment.total_revenue`: confirmar se é por data de recebimento (assumido) ou data de emissão da NF
- [ ] Decidir se "Lazer" (Games, Cinema) vira categoria consolidada ou fica solto
- [x] `pluggyTransactionSync.ts` nunca atualiza uma transação já sincronizada — aconteceu de novo (Google Workspace preso em "MASTERCARD INTERNACIONAL"), então dessa vez veio a correção geral: `Transaction.pluggyPending` + reconciliação automática no próximo sync (04/09, ver "Reconciliação de transação PENDING" acima). Cobre o caso de descrição/valor mudarem entre PENDING→POSTED; não cobre uma transação que a Pluggy já marcou POSTED da primeira vez e só depois corrige (esse foi o caso original da parcela BTG — mais raro, sem sinal (`pluggyPending`) pra saber quando revisitar).
- [ ] Dividendos por posição (`PositionSnapshot.dividends`) não vêm no payload de `/investments` da Pluggy — precisa de uma chamada extra (`/investments/{id}/transactions`) pra popular; até lá, fica `null` (não é fake, é "ainda não coletado")
- [x] `BudgetTarget` por categoria — seedado (25/08) a partir da aba "ORÇAMENTO" da mesma planilha "PLANEJAMENTO - PESSOAL" (é a mesma aba que dá nome à "ORÇAMENTO — PESSOAL - 2026", não uma planilha separada). 32 categorias (8 mães + subcategorias) e o orçamento de agosto/2026 (R$9.895,70, bate com o "CUSTOS" da planilha). De quebra, populou também `Debt`/`DebtInstallment` do empréstimo do Tio João (24 parcelas, 2 pagas) que estava documentado mas nunca tinha dado real.
- [x] `Client`/`Project`/`ProjectReceipt` de Projetos — importado (02/09) da planilha real "PLANEJAMENTO - 2026": 8 clientes, 22 projetos, 21 recebimentos, 1 fornecedor. Ver "Módulo Projetos" acima.
- [ ] DAS real de cada mês de competência dos clientes estrangeiros (HKEK/PICKLEBALL FORUM/SOILYTIX) — Luiz precisa lançar em Projetos conforme os boletos forem chegando; até lá, imposto desses meses usa a estimativa de 6%
- [x] Deploy do módulo Projetos em produção (02/09) — migração + rebuild + dado real (8 clientes/22 projetos/21 recebimentos/1 fornecedor) subidos: parei o `financial-hub`, fiz backup do `prod.db`, copiei `tmp-import/import-projects.cjs` pro servidor (mesma estrutura relativa, senão o `require("../backend/node_modules/...")` resolve errado) e rodei com `node -r dotenv/config` pra pegar o `DATABASE_URL` de produção. Confirmado por SQL direto (8/22/21/1/1/1) sem duplicar nada (produção estava zerada nessas tabelas) — script e backup apagados do servidor depois de confirmar.
- [ ] Webhook de deploy automático (`git push` → atualiza sozinho) ainda só funciona pro `aberto-cms` — generalizar ou criar um separado pro Financial Hub
- [ ] Compras "PEOPLE BIKE SHOP" (C6, R$1.159, total=10), "MERCADOLIVRE\*MERCADOL"/Capacete (C6, R$34,03, total=5) e "TOKSTOK TOKSTOK-629857" (C6, R$387,79, total=10) não têm projeção automática de parcela futura — as duas primeiras porque a Pluggy não manda `billForecastDate` na transação mais recente, a do Tokstok porque a transação com forecast é de março/26, antes do recurso de projeção existir no código (ver seção "Mais 3 correções pontuais de parcela" acima). Linhas manuais (`description` já corrigido pro nome real) seguram o lugar por enquanto. Quando a Pluggy passar a mandar o forecast de cada uma (normalmente quando a próxima parcela fechar fatura), o sync vai criar as linhas reais com `externalId` — nesse momento apagar as manuais (viram duplicata).

## Decisões de navegação/IA

- **"Transações" e "Dia a dia" deixaram de existir como conceitos separados** (24/08/2026) — viraram **"Orçamento"** (nav + seção do dashboard): lançamentos, meta diária e orçamento por categoria moram juntos ali, espelhando a aba "ORÇAMENTO" da planilha.
- Cada área principal (**Orçamento**, **Patrimônio**, **Projetos**) ganhou página própria com funções e visualizações específicas — o dashboard (Início) fica como resumo/atalho, o detalhe mora na página de cada área. As três já saíram do placeholder; nenhuma página usa mais `PlaceholderPage` (removido do projeto em 02/09).
