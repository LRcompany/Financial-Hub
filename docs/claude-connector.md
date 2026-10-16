# Conector do Claude (Command OS)

Permite falar com o Claude (iPhone, site, desktop e Claude Code) sobre as finanças do Luiz com os números reais do Command OS. **Só leitura**: nenhuma ferramenta grava nada.

- **Endereço:** `https://command.luizrodrigues.com/mcp` (MCP, Streamable HTTP, sem estado).
- **Login:** OAuth 2.1 com consentimento pela senha de 6 dígitos do app (`backend/src/services/oauth.ts`). Só apps do Claude (`claude.ai`/`claude.com`) e `localhost` podem se registrar.
- **Ferramentas** (`backend/src/mcp/server.ts`): `resumo_financeiro`, `orcamento`, `gastos`, `parcelas`, `patrimonio`, `projetos`, `historico_mensal`. Todas chamam por dentro os mesmos endpoints da tela, então os números batem com o app.
- **Skill:** `skill/SKILL.md` (fonte). O pacote para instalar é `dist-skill/command-os-skill.zip`; regere o zip sempre que mudar o `SKILL.md`:

```bash
cd ~/Desktop/Work/CLAUDE/Financial-Hub && mkdir -p dist-skill/command-os && cp skill/SKILL.md dist-skill/command-os/ && (cd dist-skill && rm -f command-os-skill.zip && zip -qr command-os-skill.zip command-os)
```

## Instalar no app do Claude (iPhone / site)

Faz uma vez só, pelo site (claude.ai) ou pelo app. Vale para todos os aparelhos da conta.

1. **Conector:** Configurações → Conectores → **Adicionar conector personalizado**.
   - Nome: `Command OS`
   - URL: `https://command.luizrodrigues.com/mcp`
   - Clicar em **Conectar**: abre a página do Command OS pedindo a senha de 6 dígitos → **Entrar e permitir**.
2. **Skill:** Configurações → Capacidades → Skills → **Enviar skill** → escolher `dist-skill/command-os-skill.zip`.
3. Numa conversa, deixar o conector **Command OS** ligado (ícone de ferramentas) e perguntar, ex.: *"como estão minhas finanças esse mês?"*.

## Conectar o Claude Code (Mac)

O comando busca o token direto do servidor, sem ele passar pelo chat:

```bash
claude mcp add --transport http --scope user command-os https://command.luizrodrigues.com/mcp --header "Authorization: Bearer $(ssh root@143.110.146.35 'grep ^MCP_TOKEN= /root/apps/financial-hub/backend/.env | cut -d= -f2')"
```

## Servidor

- `.env` do backend precisa de `MCP_TOKEN` (token fixo do Claude Code, `openssl rand -hex 32`) e `APP_ORIGIN=https://command.luizrodrigues.com`.
- nginx repassa para o backend (porta 3333): `/api/`, `/mcp`, `/oauth/` e `/.well-known/oauth-`.
- Cortar o acesso de um app: apagar as linhas dele em `OAuthClient` (os tokens saem em cascata). Trocar o `MCP_TOKEN` corta o Claude Code.
