# Design System

Referência visual completa: artifact **Design System** (Claude) — cor, tipografia, forma, iconografia, glassmorphism, campos de formulário e componentes, com exemplos renderizados.

**Fluxo de trabalho**: qualquer decisão visual nova é feita e validada primeiro no artifact (é rápido de iterar lá, visual, sem precisar rodar o app). Depois de validada, o mesmo valor é espelhado em [`frontend/src/styles/tokens.css`](../frontend/src/styles/tokens.css) — esse arquivo é o que o código de verdade importa. Se um valor divergir entre os dois, o artifact é a fonte de verdade; o CSS precisa ser atualizado pra bater com ele, nunca o contrário.

## Decisões já travadas

- **Base**: branco puro (não bege/creme) — cards também brancos, separados por borda fina + sombra leve, nunca por mudança de cor de fundo
- **Acento**: azul-índigo, único — sem segunda cor de destaque competindo
- **Gradiente** (vermelho→laranja→amarelo→verde→teal→azul): assinatura visual só de gráfico/progresso — nunca em texto ou fundo de card
- **Tipografia**: Proxima Nova (produção, via Adobe Fonts) / Inter (fallback). **Peso máximo: Semibold — nunca Bold ou Black**, em nenhum tamanho
- **Botão**: nunca tem borda — cor sólida (ação principal) ou fill neutro cinza-clarinho (ação secundária). Borda fica reservada pra caixa/card
- **Ícone de interface**: [Lucide](https://lucide.dev) (ISC license), traço 2px, 14px de tamanho, cor herda de `currentColor`
- **Ícone de categoria/transação**: emoji colorido — nunca Lucide aqui, cor é informação (reconhecer categoria de relance)
- **Glassmorphism**: `backdrop-filter` real, só em elemento flutuante (modal, bottom sheet, tooltip de gráfico, header fixo ao rolar, tab bar). Nunca em número ou valor principal — precisão de leitura vem antes de estilo
- **Espaçamento**: escala 4/8 (4, 8, 12, 16, 24, 32, 48px) — 16px entre elementos de um bloco, 24px entre blocos, 48px entre seções
- **Barra de progresso**: cor semântica (verde/amarelo/vermelho) pra orçamento com limite; gradiente pra dívida/patrimônio (é evolução, não limite)
- **Navegação inferior**: fixa, glass (é elemento flutuante), 5 itens — Início, Transações, Patrimônio, Projetos, Mais

## Pendências

- [ ] Confirmar o nome exato da família exposta pelo kit Adobe Fonts do Luiz (provavelmente `proxima-nova`) e adicionar o `<link>` do projeto no `index.html` quando o frontend for scaffoldado
- [ ] Definir estado vazio, skeleton de carregamento, toast e estrutura de modal/bottom sheet
- [ ] Decidir: cor em toda transação (vermelho/verde por padrão) ou neutro no dia a dia, cor só quando é status real (pago/atrasado) — ainda em aberto com o Luiz
