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

## Login (senha de 6 dígitos + Face ID/Touch ID)

O app inteiro fica atrás de login — uso pessoal, sem sistema de contas, só uma trava de acesso: uma senha de 6 dígitos (sempre disponível) e, opcionalmente, Face ID/Touch ID por aparelho como atalho pra não digitar toda vez. No primeiro acesso, o próprio app pede pra você definir a senha — não tem usuário/senha pré-cadastrado em lugar nenhum.

**Importante sobre o primeiro acesso**: enquanto ninguém definiu a senha ainda, quem abrir a URL primeiro é quem define — não tem "esqueci a senha" nem confirmação por e-mail (é um app de usuário único). Assim que subir no servidor pela primeira vez, abra o app você mesmo e defina a senha imediatamente, antes de deixar a porta/domínio exposto por mais tempo que o necessário.

**Face ID/Touch ID exige HTTPS de verdade** (é uma exigência do próprio WebAuthn, não uma escolha nossa) — sem domínio + certificado válido, só a senha de 6 dígitos funciona (o que já é suficiente, o Face ID é só um atalho). `APP_ORIGIN` no `.env` precisa ser a URL EXATA que o navegador usa pra abrir o app (protocolo + domínio, sem barra no final) — um `https://` vs `http://` ou `www.` a mais/a menos já é o suficiente pra travar o cadastro do Face ID.

## Deploy (self-hosted)

```bash
# No servidor, depois de dar git pull:
cd backend
npm install
npx prisma migrate deploy   # aplica as migrações no banco de produção (nunca `migrate dev` em produção)
npm run build
# preencher/atualizar o .env de produção (ver backend/.env.example) —
# principalmente APP_ORIGIN com o domínio real e um SESSION_SECRET novo
# (openssl rand -hex 32), nunca reaproveitar o de dev
npm run start                # roda dist/server.js — use pm2/systemd pra manter rodando e reiniciar sozinho

cd ../frontend
npm install
npm run build                # gera frontend/dist — servir como arquivo estático (nginx) ou via um serviço próprio
```

O nginx (ou proxy reverso equivalente) precisa: servir `frontend/dist` como estático, encaminhar `/api/*` pro backend (porta do `PORT` no `.env`), e terminar HTTPS no domínio configurado em `APP_ORIGIN` — sem isso o Face ID não funciona (a senha de 6 dígitos funciona igual).
