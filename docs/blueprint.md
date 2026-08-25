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
  - **Uma box por tipo de ativo** (25/08) — cada tipo (Renda Fixa, Ação, FII, Fundo, Cripto, Moeda) vira seu próprio card. "Por corretora" continua pizza (poucas fatias, funciona bem); "**por ativo**" virou `RankedBarList` (barra ranqueada, top 8 + "Outros") em vez de uma segunda pizza — pizza com 15-25 fatias (Ação tinha 15, Renda Fixa competia com ela) ficava ilegível e repetitiva ao lado da primeira. Fonte: `GET /api/positions` (agrupa por tipo, mesma regra de "posição ativa" de `wealth-overview`).
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

### Phantom on-chain real (25/08)

`services/solana.ts` — consulta pública na blockchain Solana (RPC `api.mainnet-beta.solana.com`, sem chave), só com o endereço público da carteira (nunca a seed phrase). `Broker.dataSource = "onchain_query"` + `onchainAddress` preenchidos pro Phantom; `POST /api/brokers/:id/sync` já sabe rotear pra Pluggy ou on-chain de acordo com o `dataSource`.
- Cobre só o saldo nativo de SOL por enquanto (não os tokens SPL/outras criptos na mesma carteira — precisaria de `getTokenAccountsByOwner` + preço por token, ainda não construído).
- Preço em BRL via CoinGecko (`simple/price`, público, sem chave).
- `investedAmount`: a blockchain não guarda preço de compra — herda o valor do snapshot anterior (mantém uma base de custo), ou usa o valor de mercado na primeira vez (equivale a "ainda não sei o ganho/perda", não inventa um número).
- A posição estimada antiga da planilha (R$1.258,11) foi substituída pelo saldo real (R$1,77 — a carteira tem bem menos SOL do que a estimativa manual supunha).

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

## Pendências (não travadas ainda)

- [ ] `TaxPayment.total_revenue`: confirmar se é por data de recebimento (assumido) ou data de emissão da NF
- [ ] Decidir se "Lazer" (Games, Cinema) vira categoria consolidada ou fica solto
- [ ] Dividendos por posição (`PositionSnapshot.dividends`) não vêm no payload de `/investments` da Pluggy — precisa de uma chamada extra (`/investments/{id}/transactions`) pra popular; até lá, fica `null` (não é fake, é "ainda não coletado")
- [x] `BudgetTarget` por categoria — seedado (25/08) a partir da aba "ORÇAMENTO" da mesma planilha "PLANEJAMENTO - PESSOAL" (é a mesma aba que dá nome à "ORÇAMENTO — PESSOAL - 2026", não uma planilha separada). 32 categorias (8 mães + subcategorias) e o orçamento de agosto/2026 (R$9.895,70, bate com o "CUSTOS" da planilha). De quebra, populou também `Debt`/`DebtInstallment` do empréstimo do Tio João (24 parcelas, 2 pagas) que estava documentado mas nunca tinha dado real.
- [ ] `Client`/`Project`/`ProjectReceipt` de Projetos — essa é uma planilha de verdade separada ("PLANEJAMENTO - 2026"), ainda sem acesso

## Decisões de navegação/IA

- **"Transações" e "Dia a dia" deixaram de existir como conceitos separados** (24/08/2026) — viraram **"Orçamento"** (nav + seção do dashboard): lançamentos, meta diária e orçamento por categoria moram juntos ali, espelhando a aba "ORÇAMENTO" da planilha.
- Cada área principal (**Orçamento**, **Patrimônio**, **Projetos**) vai ganhar página própria com funções e visualizações específicas — o dashboard (Início) fica como resumo/atalho, o detalhe mora na página de cada área. `Patrimônio` é a primeira a sair do placeholder (ver "Frontend" acima); Orçamento e Projetos ainda são `PlaceholderPage`.
