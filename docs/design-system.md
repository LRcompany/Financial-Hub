# Design System

Referência visual completa: artifact **Design System** (Claude) — cor, tipografia, forma, iconografia, glassmorphism, campos de formulário e componentes, com exemplos renderizados.

**Fluxo de trabalho**: qualquer decisão visual nova é feita e validada primeiro no artifact (é rápido de iterar lá, visual, sem precisar rodar o app). Depois de validada, o mesmo valor é espelhado em [`frontend/src/styles/tokens.css`](../frontend/src/styles/tokens.css) — esse arquivo é o que o código de verdade importa. Se um valor divergir entre os dois, o artifact é a fonte de verdade; o CSS precisa ser atualizado pra bater com ele, nunca o contrário.

Este documento é organizado por TEMA (cor, botão, modal, lista, gráfico...), não por data — é a referência que qualquer sistema novo (ou qualquer tela nova deste) deve seguir sem precisar reconstruir o raciocínio do zero. Cada regra tem o "porquê" junto, porque o porquê é o que evita reintroduzir o mesmo bug de um jeito ligeiramente diferente.

## Cor

- **Base**: branco puro (não bege/creme) — cards também brancos, separados por borda fina + sombra leve, nunca por mudança de cor de fundo.
- **Acento**: azul-índigo (`--accent`), único — sem segunda cor de destaque competindo.
- **Gradiente** (`--grad`: vermelho→laranja→amarelo→verde→teal→azul): assinatura visual só de gráfico de linha mais complexo (evolução de patrimônio, recebido no ano, gasto diário) — nunca em texto, fundo de card, ou barra de progresso simples.
- **`--fill-muted` (cinza) vs. `--accent-soft` (azul claro)** — a distinção que mais se confunde: `--accent-soft` é reservado pra SELEÇÃO/destaque de verdade (item ativo de menu, chip marcado, aba selecionada) — nunca pra "isso está expandido/aberto" ou qualquer outro estado de exibição neutro. Estado neutro (expandido/colapsado, hover, fundo secundário de botão) é sempre `--fill-muted`. Achado real (11/09, Luiz: "o fundo das categorias precisa ser cinzinha claro, não esse azul, eu já falei isso antes"): `.accordionOpen` (categoria-mãe expandida em Orçamento) usava `--accent-soft` só porque o grupo tava aberto, sem seleção nenhuma acontecendo ali.
- **Cor do valor de transação/dinheiro: texto sempre preto/neutro (`--ink`) — nunca vermelho/verde.** A direção (entrada/saída) é indicada por uma setinha colorida ao lado do valor (← verde entrada, → vermelho saída), não pelo texto. Vermelho/verde no texto fica reservado só pra status real (pago, atrasado) ou pra um BANNER que é uma frase de alerta inteira (ver abaixo) — nunca pra um número isolado.
- **Comparativo com mês anterior / rentabilidade (`MonthDelta`, `ReturnBadge`)**: mesma regra acima, generalizada — qualquer número que mostra "melhor/pior que uma referência" usa uma setinha colorida (↑/↓) pra indicar direção, e o texto do valor/percentual ao lado fica sempre neutro. `ReturnBadge` reaproveita o CSS do `MonthDelta` em vez de duplicar; qualquer comparação nova desse tipo segue o mesmo padrão, nunca um terceiro estilo.
- **"Estourei a meta" nunca muda a cor do número, da barra de progresso ou do fundo da linha** (`SpentPlannedValue`) — o único sinal permitido ali é o ícone `OverBudgetIcon` (círculo `--danger-soft`/ícone `--danger`, 14px, **sempre depois** do texto/valor que marca). Único componente pra essa marca em todo o app — nunca `<AlertTriangle className={...}>` solto de novo (foi essa duplicação, em 8 lugares, que motivou unificar em 11/09).
- **Exceção: banner de aviso com FRASE INTEIRA pode usar `--danger-soft`/`--danger` de verdade.** A regra "nunca colorir um valor isolado" continua valendo — mas um banner que É a mensagem de alerta em si ("Ultrapassou o planejado em...", não um número dentro de um card neutro) pode e deve usar a cor semântica no texto inteiro, mesma paleta do `OverBudgetIcon`. A distinção: o alerta é o CONTEÚDO da frase, não um número que também aparece em outro lugar neutro — colorir a frase não introduz uma segunda hierarquia conflitante.
- **Barra de progresso**: sempre `var(--accent)` (azul-índigo único) — nunca cor semântica por categoria (Moradia verde, Supermercado amarelo não faz sentido, cor de categoria não é status) e nunca vermelha quando estoura a meta (ver acima).
- **Badge "projetado"** (`ProjectedTag`): pill CINZA fixo (`--fill-muted`/`--ink-soft`) — sinaliza "parte desse valor ainda não é dado confirmado, é parcela futura projetada". Nunca muda de cor.
- **Badge de parcela "N/Total"** (`InstallmentBadge`): pill AZUL (`--accent-soft`/`--accent`) com a posição da parcela. Cor diferente da tag "projetado" DE PROPÓSITO — são conceitos diferentes (qual parcela vs. isso ainda não é real) e nunca devem compartilhar a mesma classe CSS.
- **Gráfico com 2+ séries onde a cor É a informação sendo comparada** (`DividendsByMonthChart`): cores FIXAS por série, nunca cicladas por índice (diferente do `ClientPieChart`, onde a cor só distingue fatias entre si dentro de uma única pizza). Reaproveitar um tom que já existe em outro contexto quando fizer sentido (Ação usa `--accent` direto, `--dividends-fii` reaproveita o teal do `--grad`) em vez de inventar cor nova.
- **Glassmorphism**: `backdrop-filter` real (`--glass-bg`/`--glass-blur`/`--glass-border`), só em elemento flutuante (modal, bottom sheet, tooltip de valor único sobre SVG vazio, header fixo ao rolar, tab bar). Nunca em número/valor principal — precisão de leitura vem antes de estilo. **Exceção**: um popup que mostra uma LISTA de linhas sobre conteúdo denso (ver `HoverCard` abaixo) é opaco, não glass — a translucidez deixa o conteúdo de trás vazar através, ilegível.

## Tipografia

- Proxima Nova (produção, via Adobe Fonts) / Inter (fallback).
- **Peso máximo: Semibold (600) — nunca Bold ou Black**, em nenhum tamanho. Hierarquia vem de tamanho, não de peso.
- Título de seção do dashboard (`.sectionTitle`): `0.6rem`, uppercase, `letter-spacing: 0.06em`, cor `--ink-soft`, peso 600.
- **Uma página, um `<h1>`** (`cards.module.css` → `.pageTitle`): toda página tem exatamente um `<h1 className={cards.pageTitle}>` com o nome da página — nunca uma cópia local do mesmo CSS num `.module.css` de página. Agrupador DENTRO de uma página é sempre `<h2 className={cards.sectionTitle}>`, nunca `<h1>`.

## Espaçamento

- Escala 4/8: `--space-1` (4px) a `--space-7` (48px). Regra prática: 16px (`--space-4`) entre elementos de um bloco, 24px (`--space-5`) entre blocos, 48px (`--space-7`) entre seções.
- Espaçamento entre blocos dentro do mesmo card é **sempre incondicional** — nunca `marginTop: condição ? 'var(--space-5)' : 0`. "0 quando o bloco anterior não renderiza" é um bug real (tudo colado quando um bloco intermediário não existe): espaçamento entre blocos não depende de quais blocos vieram antes.
- **Regra técnica: `flex: 1` puro nunca conta pro `flex-wrap` decidir quebrar linha.** `flex: 1` tem `flex-basis: 0%` — o algoritmo de wrap só considera "não coube" o tamanho PREFERIDO (basis) de cada item; um item de basis zero nunca dispara quebra, só encolhe (às vezes até sumir), colidindo visualmente com o irmão em vez de a linha quebrar limpo. Sempre que um item flexível vai conter TEXTO longo (nome de categoria/projeto, título) num container `flex-wrap: wrap` com irmãos de largura fixa (badge, chip, botão), dar um `flex-basis` de verdade — `flex: 1 1 <px razoável>` — nunca `flex: 1` sozinho.
- **Regra técnica: segurança global contra scroll horizontal** — `overflow-x: hidden` em `html, body` (`styles/global.css`) é a rede de segurança, não substitui corrigir a causa raiz de um elemento largo demais.

## Ícones

- **Ícone de interface**: [Lucide](https://lucide.dev), traço 2px, 14–16px, cor herda de `currentColor`.
- **Ícone de categoria/transação**: emoji colorido — nunca Lucide aqui, a cor é informação (reconhecer categoria de relance).

## Botões, hovers e animações

**Regra geral (11/09, pedido do Luiz: "de modo geral precisamos adicionar hovers em todos os botões... a única coisa que mostra que é clicável é o cursor mudando, precisamos de animações"): todo elemento clicável do site — botão, ícone, linha de lista clicável, chip, dot, seta de navegação — precisa de feedback visual de hover, nunca só o cursor mudando.** Isso é regra permanente: qualquer componente novo com `cursor: pointer` nasce já com um hover correspondente, do mesmo jeito que nasce com estado `:disabled`.

Convenção de qual hover usar, pela cor de fundo em repouso do elemento (não inventar uma quarta variação):

- **Fundo sólido `--accent`** (botão primário: Salvar, Confirmar, CTA): hover troca pra `var(--accent-hover)` — token dedicado já existe em `tokens.css`, claro/escuro sincronizado.
- **Fundo `--fill-muted`** (botão secundário: Cancelar, ação neutra, ícone default): hover usa `color-mix(in srgb, var(--fill-muted) 90%, var(--ink) 10%)`. **Nunca `filter: brightness()`** pra esse caso — um cinza já bem claro no modo claro (ou já quase preto no modo escuro) mal muda de tom com brightness, o hover fica imperceptível num dos dois temas. `color-mix` misturando 10% de `--ink` escurece no claro E clareia no escuro automaticamente (`--ink` é quase-preto no claro, quase-branco no escuro), sem precisar de um `:hover` separado dentro do `@media (prefers-color-scheme: dark)`.
- **Fundo transparente/ghost** (ícone sem fundo, item de lista clicável, linha de accordion): hover ganha fundo `var(--fill-muted)` (padrão já usado em `IconButton` variante `ghost`, `.categoryRowButton`, `.listRowButton`, `.progressRowButton`). Se o elemento já fica DENTRO de algo que tem `--fill-muted` de fundo (ex: header de accordion já aberto), o hover precisa de um tom A MAIS pra continuar visível — usar o mesmo `color-mix` acima em vez de repetir `--fill-muted` (que ficaria idêntico ao repouso).
- **Fundo `--danger-soft`/texto `--danger`** (ação destrutiva: excluir, logout): hover intensifica com `color-mix(in srgb, var(--danger-soft) 80-88%, var(--danger) 12-20%)`, mesmo princípio do `--fill-muted`.
- **Transição**: `transition: background-color 0.15s ease` (ou `color`/`filter` quando é isso que muda) em todo botão — mesma duração em todo o app pra sensação consistente. `IconButton.module.css` (`.btn`) já define essa transição + `transform: scale(0.96)` no `:active` como base compartilhada de qualquer botão de ícone; `.fab` (botão flutuante de adicionar) segue o mesmo princípio de "encolhe um pouco ao clicar".
- **Gráfico interativo não usa CSS `:hover` — usa estado React** (`ClientPieChart`: `activeIndex`) pra destacar a fatia/legenda sob o mouse e apagar (opacity reduzida) as demais ao mesmo tempo — o "hover" ali é uma correlação entre dois elementos (fatia ↔ linha da legenda), não um efeito isolado, então não dá pra fazer só em CSS.
- **Nunca duplicar esses padrões copiando o CSS pra um botão novo** — se o botão novo é primário/secundário/ghost/danger, ele é um desses quatro casos; escrever o hover certo direto, não "esquecer e adicionar depois".

## Campos de formulário

- Componentes `<Input>`/`<Select>` (`components/Input.tsx`+`.module.css`, `components/Select.tsx`) — **único** lugar que estiliza `<input>`/`<select>` no projeto, nunca uma classe solta numa página nova.
- `width: 100%` explícito (não depende de stretch de flexbox).
- Borda 1px + `--r-sm` (borda em input/card é ok — a regra "nunca borda" é só de BOTÃO).
- Setinhas nativas de `<input type="number">` removidas (`-webkit-appearance: none`) — controle de sistema operacional destoa do resto do app.
- `<Input label="...">` já embute o rótulo, não precisa envolver na mão.

## Modais (`ModalShell`)

**Toda modal do app usa [`ModalShell`](../frontend/src/components/ModalShell.tsx) — nunca reimplementar `overlay`/`sheet` do zero.** Regra travada pelo Luiz (11/09): *"o scroll precisa ser apenas dentro do conteúdo, não é pra mover a modal inteira... isso tem que ser uma regra aplicada em todo o site pra todas as modais."* Achado real que motivou a regra: as modais do app (9 originais + 4 formulários de `Projetos.tsx` descobertos depois, achado 2, abaixo) tinham cada uma seu próprio `overlay`/`sheet` copiado, todas com o MESMO bug — `.sheet { overflow-y: auto }` na sheet inteira, rolando cabeçalho e tudo junto.

**Contrato** (`{ title, subtitle?, headerActions?, footer?, printable?, onClose, maxWidth?, children }`):

- `title` (obrigatório) + `subtitle?` (opcional) formam o cabeçalho — cobre desde "só título" (`BudgetReviewModal`) até "título + subtítulo" (`ContributionModal`).
- `headerActions?` — ação extra ANTES do X de fechar, no mesmo cabeçalho (ex: "Baixar PDF" em `MonthlyReportModal`).
- Cabeçalho e `footer` ficam **FORA da área de scroll, sempre visíveis** — só `.content` rola. Modal sem `footer` só tem cabeçalho fixo + conteúdo rolável.
- `footer?` — o par Cancelar/Salvar (ou similar) que fecha um formulário inteiro. **Padrão pra Salvar que precisa ficar no footer fixo mas submeter um `<form>` que está dentro do `.content` rolável**: dar `id` ao `<form>` e usar `<button type="submit" form="meu-id">` no footer — o atributo HTML `form` submete um form do qual o botão NÃO é descendente no DOM. Evita duplicar `onSubmit`/estado entre header e conteúdo.
- `maxWidth?` (padrão 480px) — modal com tabela/gráfico largo (relatório mensal, revisão de transações) passa um valor maior (640–960).
- `printable?` — caso raro de modal que também é tela de impressão (`MonthlyReportModal`, `window.print()`): no papel o cabeçalho/rodapé somem e o conteúdo perde limite de altura/scroll pra paginar direito. `@media print` cuida disso dentro do próprio `ModalShell.module.css`.
- Fechar clicando fora (`overlay` `onClick`) sempre chama o mesmo `onClose` do X — `stopPropagation` no `sheet` evita fechar clicando dentro.

**Onde procurar antes de assumir que uma modal está migrada**: o achado de 11/09 (item 5, registro do DAS) foi um `Modal` local em `Projetos.tsx` usado por 4 formulários (novo projeto, novo recebimento, novo fornecedor, pagamento a fornecedor) que a varredura original não pegou porque procurava só por `styles.overlay`/`styles.sheet` — esse arquivo usava nomes diferentes (`styles.modalOverlay`/`styles.modalSheet`). **Ao auditar modais duplicadas numa página, procurar por qualquer componente local chamado `Modal`/`*Modal` que renderize um overlay fixo, não só pelo nome exato da classe CSS.**

## Listas e tabelas: desktop ↔ mobile

- **Tabela em tela estreita SEMPRE vira lista de cards, nunca fica só com scroll horizontal.** Um card por linha da tabela, cada coluna virando um par label:valor empilhado. O toggle é sempre por CSS puro, breakpoint `max-width: 640px`, escondendo o `.tableWrap` (a versão `<table>`, com `overflow-x: auto` de fallback) e mostrando a versão em cards — nunca deixar uma tabela nova só com scroll horizontal como única saída no mobile. Padrão em uso: "Comprometido em parcelas futuras" (Orçamento), tabela de posições e "Projeção ano a ano" (Patrimônio).
- **Linha de lista genérica (não-tabela) não precisa desse toggle** — o mesmo `.listRow` (`cards.module.css`) já é responsivo por natureza (flex, quebra sozinho); o padrão table→card é só pra dado tabular de verdade (várias colunas numéricas lado a lado).
- **Linha de lista clicável (`.listRow` + `.listRowButton`, `cards.module.css`, 11/09)**: reseta um `<button>` (`background: none; border: none; text-align: left; font: inherit; cursor: pointer`) mantendo a MESMA estrutura visual de `.listRow`, e adiciona hover `--fill-muted` que sangra até a borda do card via margem negativa (`margin: 0 calc(var(--space-4) * -1); padding-left/right: var(--space-4)`) — o hover preenche a largura inteira do card, não só o texto. Usado quando uma linha de lista antes só-leitura vira clicável pra abrir uma modal de edição (ex: transações — ver abaixo). O mesmo princípio, com a mesma margem negativa mas escala menor (`--space-2`/`--space-3`), serve pra uma linha que já tinha outro layout e só precisa virar clicável sem redesenhar tudo (`.categoryRowButton` no Orçamento, `.progressRowButton`, `.projectHeaderRow` em Projetos).
- **Edição de item de lista sempre em modal, nunca inline na própria linha** (11/09, pedido do Luiz: *"a edição tem que rolar através de modal e não diretamente na lista... não fica intuitivo que dá pra clicar em nota e editar"*). Antes, "Todas as transações do mês" (Orçamento) tinha `<Select>`/`<Input>` abertos direto em cada linha da lista o tempo todo; agora a linha é só leitura + clicável (`.listRow .listRowButton`), o clique abre `TransactionEditModal` com os mesmos campos. **Um componente de edição por CONCEITO, usado em toda tela que mostra aquele conceito** — `TransactionEditModal` é usado tanto em Orçamento ("Todas as transações do mês") quanto no Dashboard ("Últimas transações"), nunca duas modais quase-iguais pro mesmo dado.

## Gráficos

- **Gráfico de barra vertical (`VerticalBarChart`)**: todas as barras em `var(--accent-soft)`, sólido, por padrão — destaque é só de INTERAÇÃO (a coluna sob o mouse marca em `var(--accent)`/`var(--ink)` via `:hover`), nunca fixo num item. Itens de um "por ativo" não têm relação de ranking entre si; marcar um permanentemente sugeriria uma hierarquia que não existe.
- **Radius de barra**: token dedicado `--r-bar` (4px) — TODO gráfico de barra (progresso, cartão de crédito, ranking por ativo) usa esse token, nunca `--r-full`/`--r-lg`/`--r-sm`. Um radius maior que a altura real da barra faz qualquer barra curta virar uma pílula arredondada visualmente igual às outras, escondendo a proporção entre os valores.
- **Truncamento de "Outros"**: `max` de itens exibidos alto o bastante (padrão 20) pra não truncar em casos reais de portfólio grande — a barra estreita sozinha via `flex: 1`, não precisa cortar informação por falta de espaço; "Outros" é só fallback pra quando o número de itens realmente estoura.
- **Gráfico de linha (`SmoothLineChart`)**: linhas verticais finas e sutis (`var(--border)`, opacidade 0.5) SEMPRE visíveis, marcando a posição de até 8 pontos (`pickTickIndices` distribui igualmente com muitos pontos, incluindo sempre o primeiro/último) — sem isso o gráfico é uma curva solta sem nenhuma referência de escala "de primeira". O hover continua existindo por cima; a linha ativa fica mais escura (`var(--ink-soft)`) pra se diferenciar das linhas de fundo — demarcação é o "de primeira", hover é o "valor exato".
- **Gráfico de pizza (`ClientPieChart`)**: hover é uma correlação fatia ↔ legenda via estado React (`activeIndex`), não CSS — passar o mouse numa fatia OU numa linha da legenda destaca as duas juntas e reduz a opacidade das demais (0.35–0.4). A cor de cada fatia só distingue fatias ENTRE SI dentro da mesma pizza — se o gráfico precisar comparar a MESMA série entre várias instâncias (ex: mês a mês), a cor vira informação fixa por série (ver `DividendsByMonthChart` na seção Cor).
- **Espaçamento de gráfico**: rótulo do gráfico (`.chartLabel`) e o gráfico abaixo usam `--space-4` (16px, vão "dentro do bloco"); entre um bloco de gráfico e o próximo dentro do mesmo card usa `--space-5` (24px), sempre incondicional (ver seção Espaçamento).

## Popup / tooltip de detalhe (`HoverCard`)

Componente único (`components/HoverCard.tsx` + `.module.css`) — **é o único jeito de fazer hover-detalhe no projeto**, nunca duplicar esse CSS numa página nova. Usos hoje: nome de ativo na tabela de posição (emissor, taxa, vencimento, ISIN, USD quando aplicável) e rótulo de barra/item agrupado em gráfico (quando um bucket junta mais de uma posição). Generalizar pra qualquer lista nova segue sempre `<HoverCard content={...}><span>{nome}</span></HoverCard>` — `content` null renderiza só o filho, sem popup vazio nem sublinhado tracejado.

Duas regras técnicas nascidas de bugs reais, ambas permanentes:

- **Portal + `position: fixed`, nunca `position: absolute` filho do próprio gatilho.** Um popup absoluto fica sujeito ao `overflow` de qualquer ancestral no caminho até a raiz — inclusive um que parece inofensivo (`overflow-x: auto` sozinho também vira `overflow-y: auto` por regra do CSS, cortando um popup tentando escapar pra cima). Fix: `createPortal` pra `document.body` + coordenadas via `getBoundingClientRect()` no `mouseenter`, show/hide por classe JS (`.popupVisible`) — não mais `:hover` em CSS puro, já que o popup deixa de ser descendente do gatilho no DOM. Qualquer popup/tooltip novo no projeto segue esse padrão.
- **Opaco (`var(--surface)`), não glass — exceção documentada à regra geral de glassmorphism.** Um tooltip de VALOR ÚNICO sobre área vazia de SVG pode ser glass (`SmoothLineChart`, `ClientPieChart`); `HoverCard` mostra uma LISTA de várias linhas sobre conteúdo denso (tabela cheia de texto) — a translucidez deixava o texto de trás vazar através, ilegível.
- `.popup` tem `max-height: 320px; overflow-y: auto` — uma corretora cheia pode listar 40+ linhas num hover só; como é o componente ÚNICO e compartilhado, esse limite vale pra qualquer uso futuro automaticamente.

## Modo privacidade (`<Money>`)

TODO valor em R$ renderizado como texto — em qualquer página, modal, gráfico (inclusive tooltip de hover customizado) ou hover-card — precisa estar envolvido em `<Money>...</Money>` (`components/Money.tsx` + `lib/PrivacyContext.tsx`), sem exceção, pro ícone de olho no header borrar o valor. Nunca envolver rótulo, categoria, percentual, data ou quantidade — só o número monetário (incluindo o prefixo "R$"/"US$"). Vale pra qualquer formatação de dinheiro, não só `currency()` de `lib/format.ts` — componente novo que mostra R$ nasce já com `<Money>`, nunca "porque é só um gráfico" ou "porque é só um tooltip".

## Layout

- **Sidebar de desktop**: `position: sticky; top: 0; align-self: flex-start; height: 100svh` (`AppLayout.module.css`) — sem o `align-self: flex-start`, o `.shell` (flex row) estica a sidebar pra acompanhar a altura da página, fazendo ela rolar junto em vez de ficar fixa. Qualquer coluna lateral fixa nova segue esse padrão.
- **Navegação inferior (mobile)**: fixa, glass (é elemento flutuante), 5 itens — Início, Transações, Patrimônio, Projetos, Mais.
- **Tabela de posição por corretora standalone** (NOMAD, INCO): nunca mostra colunas "Cotas/qtd." / "Preço unit." — não existe cota nem preço de mercado por unidade numa posição de crowdfunding ou bond avulso, "—" ali só polui a tabela. Cada tipo de posição mostra só os campos que fazem sentido pra ela.

## Regras técnicas (não-visuais, mas regem UI)

- **Seletor descendente solto (`.pai span`, sem `>`) nunca deve estilizar algo que pode conter outro componente compartilhado por dentro.** `.pai span:last-child` bate em QUALQUER span descendente last-child do pai imediato — inclusive um span dois níveis abaixo, como o `.planned` de dentro de um `<SpentPlannedValue>`. Se esse seletor tiver mais especificidade que a classe própria do componente aninhado, ele VENCE e quebra a aparência sem erro de build. Sempre que o alvo é um filho DIRETO, usar `.pai > span:last-child` (combinador `>`); nunca redefinir `color`/`font-weight` num seletor desses quando o conteúdo pode ser um componente compartilhado que já cuida da própria cor.
- **`security.ticker` só é um NOME de exibição de verdade pra Ação/FII.** Pra outro tipo (Fundo, Renda Fixa) a Pluggy usa esse campo pra guardar um identificador interno (CNPJ, ISIN, CUSIP). Qualquer lugar (front OU backend) que decide entre `ticker`/`name` pra exibição precisa checar o tipo primeiro, nunca só `ticker ?? name`.
- **Consolidação de lotes de Renda Fixa/Tesouro Direto**: a Pluggy trata cada COMPRA de um mesmo título de renda fixa como um `Investment`/`Security` separado, mesmo sendo o mesmo papel — front e backend consolidam por `brokerId + (isin ?? name-fallback)` (nunca só por nome — dois papéis podem ter nome comercial igual com vencimento diferente), somando os valores e recomputando `unitValue = marketValue / quantity`. Quando o vencimento existe, o display name recebe o ANO do vencimento anexado (`displayName()`, Patrimonio.tsx) pra distinguir visualmente linhas consolidadas com nome igual ("TESOURO DIRETO - LFT 2029" vs. "...2031").
- **Fluxo (quanto entrou/saiu NUM período) nunca usa a mesma seleção de snapshot que estado (quanto vale AGORA).** `activeSnapshotsAsOf` (arrasta pra frente o último snapshot conhecido) está certo pra `marketValue`/`investedAmount` (estado); é ERRADO pra dividendo/provento/qualquer fluxo (forward-fill duplicaria um valor antigo como se fosse do mês atual). Campo de fluxo soma sempre o snapshot do mês/ano EXATO, `null` quando aquele mês não tem dado — nunca herda de mês anterior. Fluxo com histórico mais longo que o rastreamento de estado precisa de tabela PRÓPRIA (`DividendPayment`: broker+security+mês+ano+valor, gravado incondicionalmente a partir do extrato de transações) — nunca amarrado à existência de uma linha de estado do mesmo período.
- **Lançamento manual de um dado que também vem de sincronização automática grava na MESMA tabela** (`ManualDividendModal` → `DividendPayment`) — nunca um campo/tabela paralela só porque a origem é manual. É isso que garante que o dado manual apareça em TUDO que já lê aquele conceito (coluna, card agregado, seta de tendência) sem código de exibição extra.

## Pendências

- [ ] Confirmar o nome exato da família exposta pelo kit Adobe Fonts do Luiz (provavelmente `proxima-nova`) e adicionar o `<link>` do projeto no `index.html` quando o frontend for scaffoldado.
- [ ] Definir estado vazio, skeleton de carregamento e toast (ainda não padronizados como componente único).

## Adiado (não é v1)

- **Captura por voz + IA** (falar "gastei 25 no almoço" → lançamento automático, casado depois com a Pluggy): tecnicamente viável (Web Speech API + Claude API), mas adiado — Luiz decidiu não valer a pena um custo recorrente pra uma feature ainda não validada. Retomar se ele pedir de novo; nesse caso o botão flutuante (+) precisa ganhar essa opção extra, e a `Transaction` precisa de um campo `pending` + lógica de casamento com o sync da Pluggy.
