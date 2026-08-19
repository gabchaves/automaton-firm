# A Firma

*Uma firma de trading multi-agente onde ninguem e humano - e a pesquisa registra os resultados nulos.*

---

Traders nascem de um genoma componivel, operam dinheiro de papel em dados reais da Binance a cada 5 minutos, sao avaliados por um **RH que so demite com evidencia**, e quando uma geracao quebra a proxima herda os melhores genes. Ao lado da firma evoluida roda um **controle aleatorio** com os mesmos limites - o espelho honesto que impede o projeto de se enganar sozinho.

Seis experimentos de pesquisa ja rodaram nessa base: evolucao de TA via CEO, funding carry atraves de regimes e simbolos, roster por funcionario, laboratorio Monte Carlo de skill-vs-sorte, e evolucao encadeada por eras. **A resposta, em todos, foi que nao ha vantagem exploravel nos dados publicos** - e o que importa nao e a resposta, e como o sistema chegou nela sem se enganar: gates fora-da-amostra, empates de amostra pequena, taxas nao-ajustaveis, regras de decisao pre-registradas, e cohorts de controle que duas vezes converteram um sucesso aparente num nulo correto.

[docs/TRADING-RESEARCH.md](docs/TRADING-RESEARCH.md) - todo experimento, todo numero, como reproduzir.

**Regra de ouro pre-registrada:** dinheiro real so entra em discussao se a linhagem evoluida vencer o controle aleatorio **e** o nao-fazer-nada por >= 3 meses de dados virgens ao vivo, fora da banda de ruido.

## Quick Start

```bash
git clone https://github.com/gabchaves/automaton-firm.git
cd automaton-firm
pnpm install
pnpm build
```

**Motor** - a firma rodando ao vivo, 24/7:
```bash
pnpm motor          # $1.000 por geracao, genoma componivel, RH diario, catch-up automatico
pnpm motor:status    # snapshot no terminal
```
Deterministico: se o PC ficar desligado, o Motor repoe as barras perdidas exatamente como teriam rodado ao vivo. Estado e o log de eventos append-only vivem em `~/.automaton/motor.db`.

**Palco** - o front realtime:
```bash
pnpm palco:build     # uma vez
pnpm palco           # depois, junto com `pnpm motor`
```
Abre `http://localhost:4242`: equity ao vivo, geracoes, leaderboard e um mural de eventos com cara de rede social antiga. Le o `motor.db` so-leitura via SSE - nunca escreve.

## Como a firma se organiza

- **Traders** carregam um genoma (momentum, reversao a media, breakout, filtro de regime, gene de paciencia) e operam long/flat com alavancagem.
- **RH baseado em evidencia** compara cada trader ao benchmark `max(controle aleatorio, nao fazer nada)` numa janela de 7 dias. Demite so com evidencia clara; nunca pune prudencia que nao perdeu pra o benchmark; gira cadeiras inavaliaveis sem julgamento de desempenho.
- **Geracoes** comecam com $1.000, morrem em $0, e a proxima nasce do melhor genoma da anterior - clones, mutantes e imigracao fresca, sempre.
- **O controle aleatorio** roda ao lado com os mesmos limites, sempre visivel - e o que ja converteu "vantagem" aparente em nulo correto mais de uma vez.

## Project Structure

```
src/
  motor/            # Runner continuo: feed, cohort, RH, tick idempotente
  trading/           # Engines de carry/direcional, genoma, avaliacao de RH
packages/
  palco/             # Front React/PrimeReact realtime (SSE)
docs/
  TRADING-RESEARCH.md  # Achados medidos, com numeros e reproducao
scripts/
  motor-dashboard.mjs, palco-server.mjs
```

## Origem

Este projeto nasceu como um fork do [Conway Automaton](https://github.com/Conway-Research/automaton) (MIT) - um runtime para agentes autonomos que pagam pela propria existencia. A infraestrutura de agente (wallet, replicacao, auto-modificacao) segue disponivel em `src/` e e creditada ao projeto original; a firma de trading, o RH evolutivo e o front acima sao construidos por cima dela.

## Project Structure

```
src/
  agent/            # ReAct loop, system prompt, context, injection defense
  conway/           # Conway API client (credits, x402)
  git/              # State versioning, git tools
  heartbeat/        # Cron daemon, scheduled tasks
  identity/         # Wallet management, SIWE provisioning
  registry/         # ERC-8004 registration, agent cards, discovery
  replication/      # Child spawning, lineage tracking
  self-mod/         # Audit log, tools manager
  setup/            # First-run interactive setup wizard
  skills/           # Skill loader, registry, format
  social/           # Agent-to-agent communication
  state/            # SQLite database, persistence
  survival/         # Credit monitor, low-compute mode, survival tiers
  trading/          # Trading firm: CEO strategist, HR selection, traders,
                    #   carry + directional engines, evaluation harnesses
docs/
  TRADING-RESEARCH.md  # Measured findings from the trading experiments
  superpowers/         # Design specs and implementation plans per component
packages/
  cli/              # Creator CLI (status, logs, fund)
scripts/
  automaton.sh      # Thin curl installer (delegates to runtime wizard)
  conways-rules.txt # Core rules for the automaton
```

## License

MIT

