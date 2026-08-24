# Frontend

React + Vite, como PWA (manifest + service worker via `vite-plugin-pwa`), consumindo a API do `../backend`.

- **Estilo**: importa `src/styles/tokens.css` (espelho exato do [Design System](../docs/design-system.md)) — nunca hardcode cor/raio/sombra direto num componente, use as variáveis (`var(--accent)`, `var(--r-md)`...)
- **Ícones de interface**: `lucide-react`
- **Ícones de categoria/transação**: emoji colorido (não Lucide — decisão do Design System)
- **Responsivo**: mobile primeiro (nav inferior), vira sidebar + grid a partir de 900px — ver `src/layout/AppLayout.tsx`

## Rodando localmente

```bash
npm install
npm run dev
```

Espera o backend rodando em `http://localhost:3333` (variável `VITE_API_URL` se for outra porta/URL).

## Páginas

- `Dashboard` (`/`) — primeira tela real construída, com dados reais do backend (transações) e mock claramente sinalizado onde o backend ainda não tem endpoint (orçamento, patrimônio, projetos — ver comentários `// MOCK` no código)
- As demais rotas (`/transacoes`, `/orcamento`, `/patrimonio`, `/projetos`, `/configuracoes`) ainda são placeholder
