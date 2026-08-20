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

**Status de ingestão real (testado em 20/08/2026):**
- BTG → Pluggy, **testado e confirmado** (contas + investimentos vieram com dado real)
- C6, Sofisa → conectadas na Pluggy; Sofisa testada e investimento **não veio** (Pluggy documenta suporte a CDB/Fundos, mas não apareceu — provável falta de consentimento granular); C6 ainda não testada
- Mercado Pago → Pluggy confirma que **não** suporta investimentos (só conta)
- 99 → ainda não testada (só resta 1 conexão livre no plano grátis, limite de 5)
- Nomad, Wise, INCO → extrato manual
- Phantom → consulta direta na blockchain Solana via endereço público (não é Pluggy)

### Security / PositionSnapshot / WealthGoal

```
Security: name, ticker, type (FII|Ação|Renda Fixa|Cripto|Moeda|Fundo), sector, target_allocation_pct, target_dividend_yield
PositionSnapshot: broker_id, security_id, month, year, invested_amount, market_value, dividends
WealthGoal: monthly_savings_target, annual_return_assumption_pct, target_amount
```

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

## Pendências (não travadas ainda)

- [ ] Confirmar se C6 e 99 suportam investimentos via Pluggy (só resta 1 slot de conexão livre)
- [ ] `TaxPayment.total_revenue`: confirmar se é por data de recebimento (assumido) ou data de emissão da NF
- [ ] Decidir se "Lazer" (Games, Cinema) vira categoria consolidada ou fica solto
