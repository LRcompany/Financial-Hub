# Financial Hub

Sistema pessoal de Luiz Rodrigues pra organizar Financeiro Pessoal e Projetos/Trabalho Freelance num lugar só, substituindo planilhas do Google Sheets — com PWA mobile.

## Módulos

1. **Financeiro Pessoal** — fluxo de caixa, orçamento, dívidas, empréstimos e patrimônio/investimentos
2. **Projetos & Freelance** — clientes, projetos, recebimentos, fornecedores e impostos (DAS/INSS/Contador)

Os dois módulos são conectados: recebimento de projeto, pagamento de DAS e pagamento a fornecedor geram lançamentos automáticos no fluxo de caixa pessoal.

## Documentação

O modelo de dados completo — entidades, decisões de arquitetura, e o porquê de cada uma — está em [`docs/blueprint.md`](docs/blueprint.md). Antes de mexer no schema, leia esse documento; ele é a fonte de verdade das decisões já travadas.

## Stack

- **Backend**: Node.js + Express + Prisma (SQLite)
- **Frontend**: React (Vite) — PWA instalável, sem necessidade de App Store
- **Ingestão de dados**: Pluggy (Open Finance, plano pessoal gratuito), com fallback manual (OFX/extrato) — nunca dependência única de um serviço externo
- **Deploy**: self-hosted no Digital Ocean (já usado para outros projetos)

## Rodando localmente

```bash
# Backend
cd backend
npm install
npx prisma migrate dev
npm run dev

# Frontend
cd frontend
npm install
npm run dev
```

## Variáveis de ambiente

Nunca commitar credenciais. Veja `backend/.env.example` para as variáveis necessárias (Pluggy Client ID/Secret, etc.) — copie para `.env` local e preencha, ou defina como variável de ambiente do processo no servidor.
