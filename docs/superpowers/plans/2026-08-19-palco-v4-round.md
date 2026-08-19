# Palco v4 Round — Pregão/Leaderboard/Empresa/Mural/Sobre Plan

User feedback (2026-08-19, verbatim, "prompt merda mas confio em vc" — use judgment
to fill gaps): Pregão precisa de dados mais claros (lucro na última hora etc);
Leaderboard deve jogar demitidos/mortos pro final; Empresa ainda confusa — blocos
cortando, difícil saber quem é RH vs trader; Mural pode evoluir mais — posts mais
divertidos/humanizados, frequência mais baixa ainda, mais cara de Orkut; Sobre "tem
muito o que melhorar" (sem detalhes — usar julgamento: aplicar a mesma densidade
visual usada no resto do app; hoje lê como parede de texto).

Identidade é lei em todo lugar: tokens escuros pxpush (bg #1a1a1a, ink #bababa,
green #58a27a, red #c46a5a, bordas hairline, grão+scanlines, Anton/Archivo/Geist
Mono, chips fantasma). Nenhuma requisição externa nova, nenhum Math.random
(mulberry32/hashString apenas), determinismo preservado em tudo que passa pelo
Motor.

## Task A: Backend windowed stats + Pregão + Leaderboard (um commit,
packages/palco + src/motor/palco-data.ts)

### A1. Backend: `src/motor/palco-data.ts` ganha uma seção `pregao` no PalcoSnapshot
```ts
pregao: {
  evolved: WindowStats; random: WindowStats;
  bySymbol24h: Array<{ symbol: string; pnlMc: number; trades: number }>; // só evolved
}
// WindowStats = { pnl1hMc: number; pnl24hMc: number; trades1h: number; trades24h: number; winRate24h: number }
```
- `pnlXhMc` = última linha de equity_snapshots daquele cohort menos a linha mais
  próxima com `ts <= nowMs - windowMs` (fallback pra DEFAULT_EQUITY_MC quando não
  existir histórico ainda — geração nova sem 1h/24h de vida).
- `tradesXh`/`winRateXh` de eventos `trade_closed` cruzados com traders daquele
  cohort, `ts > nowMs - windowMs AND ts <= nowMs`; winRate = vitórias/trades (0
  quando trades=0).
- `bySymbol24h`: agrupa eventos `trade_closed` do cohort evoluído nas últimas 24h
  por `payload.symbol`, soma `realizedPnlMc`, conta trades; os três símbolos
  sempre presentes (0/0 quando sem trades naquele símbolo).
- Puro, usa o `nowMs` já existente (nunca `Date.now()`), só SELECTs.
Espelhar em `packages/palco/src/types.ts` + `__tests__/fixtures.ts`. Novos casos
em `palco-data.test.ts`: matemática de janela 1h/24h com snapshots+eventos
semeados, win rate, agrupamento por símbolo, fallback sem histórico.

### A2. `PregaoTab.tsx`: números legíveis por janela
Acima ou ao lado do gráfico de equity, uma fileira compacta de stat-cards
(reusar o visual de `.hero-card`, não criar estilo novo) por cohort: "Lucro 1h"
/ "Lucro 24h" (verde/vermelho pelo sinal) / "Trades 24h" / "Win rate 24h".
Abaixo/ao lado: uma tabelinha por mesa (BTC/ETH/SOL) com o P&L de 24h de cada
símbolo pra firma, números mono, verde/vermelho. Mantém o gráfico de equity,
posições e lista de trades já existentes — isso é aditivo. NumberTicker nos
valores em dinheiro (componente já existe).

### A3. `LeaderboardTab.tsx`: demitidos/mortos sempre no final
Diagnosticar primeiro: `computeLeaderboard` em palco-data.ts já ordena por
`cohort, status != 'live', book_mc DESC` — verificar se o problema visual é só
que linhas não-vivas não parecem separadas. Reforçar explicitamente no front de
qualquer forma (cinto e suspensório): ordenar no cliente por prioridade
explícita (vivo=0, demitido=1, morto=2) dentro do cohort, inserir uma divisória
sutil ("encerrados") antes da primeira linha não-viva de cada seção de cohort
(só quando existir alguma), e deixar essas linhas ainda mais discretas (opacidade
menor, mantendo os indicadores 💀/📦 já existentes). Números de rank (#1, #2...)
contam só linhas vivas.

Testes: leaderboard nunca ordena um demitido acima de um vivo mesmo com book
maior (construir fixture onde isso aconteceria sem a correção); divisória só
renderiza quando existe alguma linha não-viva.

## Task B: Correção do layout da Empresa + evolução do Mural + redesign do Sobre
(um commit, packages/palco só, sequencial depois da Task A pra evitar conflito
no theme.css)

### B1. `OrgGraph.tsx` — corrigir o corte, deixar o RH inconfundível
Diagnosticar primeiro (ler a lógica de posicionamento atual) — a fileira de
"encerrados" cresce com o tempo (rotação alimenta ela continuamente), o que o
relatório anterior já marcou como risco conhecido de coordenadas fixas na mão.
Corrigir de forma robusta: adicionar `@dagrejs/dagre` (ou construir um auto-fluxo
por fileira que espaça nós por `index * (nodeWidth + gap)` SEM capacidade
máxima fixa por fileira — o container da fileira precisa crescer/rolar, nunca
cortar) pra que uma fileira de qualquer tamanho nunca sobreponha ou corte nós.
Chamar `fitView` sempre que `employees.length` mudar, não só na montagem.
Deixar o nó do RH visualmente inconfundível: tamanho/borda/cor de destaque
próprios, ícone distinto, sua própria camada no topo com o rótulo "Recursos
Humanos" acima dele; as camadas de traders com cabeçalhos claros "A Firma" /
"Controle" / "Encerrados" — não só agrupamento espacial. Se o canvas não couber
tudo, scroll horizontal dentro do próprio container é aceitável (a página nunca
rola na horizontal) — pan/zoom do grafo continua.

Teste: fixture com muitos funcionários (10+ espalhados entre firma/controle/
encerrados) renderiza sem nenhuma sobreposição de bounding-box entre nós — um
teste de regressão de verdade pro bug de corte, não só contagem de nós.

### B2. Mural — mais divertido, mais humano, menos frequente, mais Orkut
- `muralVoice.ts`: expandir cada pool de templates pra 4-5 variantes (hoje
  2-3) pra semanas de posts não ficarem repetitivas; manter o contrato de
  seed determinístico por id de evento intacto. Afiar o humor — puxar mais pra
  a voz "darwinismo com CNPJ imaginário" já estabelecida no Sobre; posts de
  rotação continuam nunca soando como veredito de desempenho real.
- `mural-posts.ts`: subir `SMALL_TRADE_THRESHOLD_MC` de ~1% pra ~2% do
  `genStartMc` (ainda derivado, nunca fixo) pra mais trades caírem no resumo
  agrupado e menos posts individuais dispararem.
- Escalada Orkut (decorativo, mesmo padrão de aviso das reações existentes):
  um número de "karma" pequeno e determinístico ao lado do nome do autor na
  barra de título de cada post (semeado como as reações); expandir o contador
  de visitantes pra uma linha de "visitas recentes" com 2-3 nomes puxados dos
  traders conhecidos, claramente rotulada como decorativa.
Testes: tamanho mínimo dos pools (>=4 variantes cada), threshold derivado de
um genStartMc customizado na fixture, karma renderiza igual em duas renders.

### B3. `SobreTab.tsx` — redesign visual, mesma identidade, mais hierarquia
Hoje são duas paredes de texto. Reestruturar sem mudar o tom/humor do texto já
estabelecido:
- A faixa de fatos vira stat-cards de verdade (reusar o estilo `.hero-card` do
  Pregão/App pra consistência entre páginas), não chips de texto inline.
- "O projeto" se divide em 3-4 subseções curtas com mini-títulos (ex: "O que
  é" / "Como funciona" / "A regra de ouro" / "Stack") em vez de 3 parágrafos
  longos — condensar o conteúdo já existente em pedaços mais curtos e diretos
  por subseção, sem inventar afirmações novas.
- Adicionar uma faixa visual compacta de 3 passos ("Como funciona": Motor → RH
  → Recorde) usando a mesma linguagem de chip/seta do resto do site.
- "Quem constrói": dar ao autor um avatar grande de iniciais (reusar
  `avatar.ts`, mesma linguagem visual dos avatares de trader) em vez de um
  bloco só de texto.
- O banner azul da regra de ouro fica como está (já resolvido na rodada
  anterior).
Testes: atualizar as asserções existentes do SobreTab pra nova estrutura
(nome, bio, checagem de sem-telefone, presença da regra de ouro) sem
enfraquecê-las; novas asserções pros stat-cards de fatos e a faixa de 3 passos.

## Verificação (as duas tasks)
`pnpm --filter @conway/palco test && build` verde; `npx tsc --noEmit` na raiz
limpo; `npx vitest run src/__tests__/motor` verde pro pedaço de backend da
Task A. Trailer nos dois commits: "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>".
