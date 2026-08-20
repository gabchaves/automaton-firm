# A Firma — uma firma de trading onde ninguém é humano

Traders com genoma operam dinheiro de papel em dados reais da Binance. Um RH
baseado em evidência demite e contrata. Quando a geração quebra, a próxima
herda os melhores genes. E ao lado de tudo isso roda um **controle aleatório**
com os mesmos limites — o espelho que impede o experimento de se enganar sozinho.

**Nenhuma vantagem lucrativa foi encontrada em dados públicos de mercado.**

Essa frase é o resultado, não uma ressalva. Seis experimentos, seis resultados
honestos — incluindo os nulos. O que este repositório entrega não é uma
estratégia: é uma plataforma de pesquisa que se recusa a acreditar nos próprios
números sem prova, e o registro completo do que ela mediu.

📄 **[Leia a pesquisa completa →](docs/TRADING-RESEARCH.md)** · 🏗️ **[Arquitetura →](ARCHITECTURE.md)**

---

## O sistema

| Camada | O que faz |
|---|---|
| **CEO** | Um LLM escreve a estratégia da próxima geração — markdown livre ou `CarryParams` estruturado, sempre com justificativa |
| **RH** | Seleção: morte no zero, reposição de sênior, contratação de estagiário e promoção só com evidência contra benchmark |
| **Traders** | Cada um com seu próprio book e P&L. Chegou a zero, morreu |
| **Avaliação** | Janelas out-of-sample, walk-forward entre regimes e coortes de controle Monte Carlo |

Motor determinístico com retomada automática (períodos offline são repostos bit
a bit), genoma com mutação semeada, log de eventos append-only e um front
realtime em React que transforma o experimento em espetáculo.

## As travas de honestidade

Cada uma delas existe porque pegou um autoengano real durante o desenvolvimento:

- **Avaliação out-of-sample** — candidata só é julgada em janela disjunta da que treinou
- **Trava de amostra pequena** — menos de N trades fechados força empate. Um trade de sorte não coroa ninguém
- **Taxas são constante do motor, nunca ajustável** — 10 bps spot + 5 bps perp taker por perna. Nenhuma estratégia deseja seu custo pra longe
- **Tamanho de posição fixo, não evoluível** — senão a evolução "vence" por alavancagem em vez de timing
- **Coortes de controle** — decisor aleatório e população nova nunca selecionada, nos mesmos dados e parâmetros. É o que separa descoberta de história bem contada
- **Regras de decisão pré-registradas** — o limiar de "competência demonstrada" foi escrito antes de qualquer resultado existir, com banda de ruído de 45–55% que deve ser reportada como sorte
- **Falhas entram no relatório, nunca somem** — símbolos deslistados, janelas rasas e extinções aparecem com o motivo

## O que foi medido

| # | Experimento | Resultado |
|---|---|---|
| 1 | TA direcional evoluída pelo CEO | Nenhuma geração bateu a base. O raciocínio do CEO estava certo; o sinal não existia |
| 2 | Funding carry, walk-forward entre regimes | Funciona — e a única perda cai exatamente onde a teoria previa |
| 3 | Varredura de símbolos | Duas descobertas, ambas no doc |
| 4 | A firma como elenco | Mecânica ponta a ponta funciona. Estagiários não agregaram |
| 5 | Laboratório de resiliência: competência ou sorte? | Sem taxas, a vantagem colapsa de 53c para 5c — **era custo, não sinal** |
| 6 | Evolução encadeada de eras | Sobreviventes de cinco eras performaram *pior* que população nova |

### Achado mais recente — gene de paciência (19/08/2026)

Diagnóstico antes da mudança: 100 trades, 7% de acerto, **US$ 37,30 em taxas
contra ≈ +US$ 3 bruto**. Atividade era anticorrelacionada com tamanho do book.
Veredito: os traders não arriscavam de menos — estavam *girando à toa*.

| Coorte | Antes | Com paciência |
|---|---|---|
| Firma (evoluída) | $966 | **$976** |
| Controle aleatório | $231 | **$736** |

A melhora de cinco vezes **no controle** é o achado: as perdas eram taxa, não
sinal. Paciência não cria vantagem — ela para de pagar pela ausência dela, e
levanta a régua honesta que a firma precisa superar.

## Rodando

```bash
pnpm install && pnpm build

# Walk-forward entre regimes          -> reports/walkforward.html
RUN_WALKFORWARD=1 pnpm exec vitest run walkforward.gated
node scripts/walkforward-dashboard.mjs

# Laboratório de resiliência           -> reports/resilience.html
RUN_RESILIENCE=1 pnpm exec vitest run resilience.gated
node scripts/resilience-dashboard.mjs

# Evolução encadeada de eras           -> reports/era-evolution.html
RUN_ERA=1 pnpm exec vitest run era-evolution.gated
node scripts/era-dashboard.mjs

# Servidor de linhagem ao vivo (SSE)
node scripts/lineage-server.mjs --port 7878 --open
```

Relatórios caem em `reports/` (fora do git). Specs de design e planos de
implementação de cada componente vivem em `docs/superpowers/`.

## Créditos

Construído sobre o runtime [Automaton](https://github.com/Conway-Research/automaton)
(Conway Research) — agente soberano com loop contínuo, sandbox e identidade
on-chain. O README original do upstream está preservado em
[`README.upstream.md`](README.upstream.md).

A camada de firma — motor de trading, genoma, RH baseado em evidência, coortes
de controle e todo o aparato de avaliação — é trabalho meu.

**Gabriel Chaves** · [gabchaves2@gmail.com](mailto:gabchaves2@gmail.com)

Licença: ver [LICENSE](LICENSE).
