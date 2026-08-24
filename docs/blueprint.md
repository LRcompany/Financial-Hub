# Blueprint — Modelo de Dados

Versão em markdown do [Blueprint Financeiro](https://claude.ai/code/artifact/f5339da9-c43d-4928-87b3-7c33899e3011) (artifact vivo, com mais contexto visual). Este arquivo é a referência que fica versionada junto do código — atualize os dois quando o modelo mudar.

Fontes originais: planilhas Google Sheets "ORÇAMENTO — PESSOAL - 2026", "PLANEJAMENTO - PESSOAL" e "PLANEJAMENTO - 2026" (Projetos).

## Decisões de arquitetura fixadas

- **Entrega**: PWA (não app nativo — evita taxa da App Store e expiração de build sem conta paga)
- **Tudo self-hosted no Digital Ocean do Luiz** — sem serviço externo pago por padrão. Único serviço externo aceito: **Pluggy** (Open Finance), porque não existe alternativa self-hosted pra ler dados bancários — e mesmo assim, arquitetado como camada plugável (nunca dependência única, sempre com fallback manual)
- **Ordem de construção**: estrutura → backend/mecânica → UI por último (Luiz é designer e quer explorar a interface com calma, sabendo exatamente o que cada tela precisa suportar)
- **Stack**: Node.js + Express + Prisma + SQLite (backend), React/Vite PWA (frontend)

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
- `Conexoes.tsx` (rota `/configuracoes`) — widget da Pluggy embutido, lista de bancos conectados com Sincronizar/Reconectar.
- `CardHeader` (`components/CardHeader.tsx`) e `currency()` (`lib/format.ts`) viraram compartilhados — `Dashboard.module.css` virou `styles/cards.module.css`, o "kit de card" que qualquer página nova (Orçamento, Projetos) reaproveita em vez de duplicar.

## Pendências (não travadas ainda)

- [ ] `TaxPayment.total_revenue`: confirmar se é por data de recebimento (assumido) ou data de emissão da NF
- [ ] Decidir se "Lazer" (Games, Cinema) vira categoria consolidada ou fica solto
- [ ] Dividendos por posição (`PositionSnapshot.dividends`) não vêm no payload de `/investments` da Pluggy — precisa de uma chamada extra (`/investments/{id}/transactions`) pra popular; até lá, fica `null` (não é fake, é "ainda não coletado")
- [ ] Seed dos dados reais que só existem nas planilhas: `WealthGoal`/`WealthGoalYearly` (aba "Primeira Milha(o)"), histórico de `PositionSnapshot` mês a mês de 2023 a hoje (aba "Investimento26" e equivalentes de 25/24/23 — só o passado; agosto/2026 em diante já é sync real da Pluggy), `BudgetTarget` por categoria, `Client`/`Project`/`ProjectReceipt` de Projetos — depende de reabrir o acesso à planilha "PLANEJAMENTO - PESSOAL" (link caiu do contexto numa compactação de conversa)

## Decisões de navegação/IA

- **"Transações" e "Dia a dia" deixaram de existir como conceitos separados** (24/08/2026) — viraram **"Orçamento"** (nav + seção do dashboard): lançamentos, meta diária e orçamento por categoria moram juntos ali, espelhando a aba "ORÇAMENTO" da planilha.
- Cada área principal (**Orçamento**, **Patrimônio**, **Projetos**) vai ganhar página própria com funções e visualizações específicas — o dashboard (Início) fica como resumo/atalho, o detalhe mora na página de cada área. `Patrimônio` é a primeira a sair do placeholder (ver "Frontend" acima); Orçamento e Projetos ainda são `PlaceholderPage`.
