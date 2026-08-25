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

## Pendências (não travadas ainda)

- [ ] `TaxPayment.total_revenue`: confirmar se é por data de recebimento (assumido) ou data de emissão da NF
- [ ] Decidir se "Lazer" (Games, Cinema) vira categoria consolidada ou fica solto
- [ ] Dividendos por posição (`PositionSnapshot.dividends`) não vêm no payload de `/investments` da Pluggy — precisa de uma chamada extra (`/investments/{id}/transactions`) pra popular; até lá, fica `null` (não é fake, é "ainda não coletado")
- [x] `BudgetTarget` por categoria — seedado (25/08) a partir da aba "ORÇAMENTO" da mesma planilha "PLANEJAMENTO - PESSOAL" (é a mesma aba que dá nome à "ORÇAMENTO — PESSOAL - 2026", não uma planilha separada). 32 categorias (8 mães + subcategorias) e o orçamento de agosto/2026 (R$9.895,70, bate com o "CUSTOS" da planilha). De quebra, populou também `Debt`/`DebtInstallment` do empréstimo do Tio João (24 parcelas, 2 pagas) que estava documentado mas nunca tinha dado real.
- [ ] `Client`/`Project`/`ProjectReceipt` de Projetos — essa é uma planilha de verdade separada ("PLANEJAMENTO - 2026"), ainda sem acesso

## Decisões de navegação/IA

- **"Transações" e "Dia a dia" deixaram de existir como conceitos separados** (24/08/2026) — viraram **"Orçamento"** (nav + seção do dashboard): lançamentos, meta diária e orçamento por categoria moram juntos ali, espelhando a aba "ORÇAMENTO" da planilha.
- Cada área principal (**Orçamento**, **Patrimônio**, **Projetos**) vai ganhar página própria com funções e visualizações específicas — o dashboard (Início) fica como resumo/atalho, o detalhe mora na página de cada área. `Patrimônio` é a primeira a sair do placeholder (ver "Frontend" acima); Orçamento e Projetos ainda são `PlaceholderPage`.
