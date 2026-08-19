/**
 * Deterministic "humanized" body copy for Mural posts (v3.2 plan, Commit
 * 2 — "mural humanizado"). `pickBody` selects one line from a fixed
 * per-event-type pool using `rng`; callers seed that rng from
 * `mulberry32(eventId)` (see rng.ts), so the SAME feed item always renders
 * the SAME joke, forever — no Math.random, matching this codebase's
 * "seeded, never Math.random" rule.
 *
 * Headlines/emojis are untouched by this module — mural-posts.ts keeps its
 * own per-type headline mapping; this file only owns the body line.
 */
import type { Rng } from "./rng";
import { usd } from "./format";

function num(payload: Record<string, unknown>, key: string, fallback = 0): number {
  const value = payload[key];
  return typeof value === "number" ? value : fallback;
}

function str(payload: Record<string, unknown>, key: string, fallback = ""): string {
  const value = payload[key];
  return typeof value === "string" ? value : fallback;
}

/** `usd()` renders a negative mc value dollar-sign-first ("$-1.20"); a
 * punchline that opens with the number (e.g. "{pnl}. Prefiro chamar de...")
 * reads more naturally sign-first ("-$1.20") — same digits, conventional
 * placement, still built on top of `usd()`. Exported so mural-posts.ts's
 * grouped "resumo da mesa" post (a fixed net>=0/net<0 line, not part of
 * these pools) can format its own net saldo the same way. */
export function signedUsd(mc: number): string {
  return mc < 0 ? `-${usd(Math.abs(mc))}` : usd(mc);
}

function pick(rng: Rng, pool: string[]): string {
  const index = Math.min(Math.floor(rng() * pool.length), pool.length - 1);
  return pool[index];
}

function tradeClosedBody(payload: Record<string, unknown>, rng: Rng): string {
  const symbol = str(payload, "symbol", "?");
  const pnl = num(payload, "realizedPnlMc");

  if (payload.liquidated === true) {
    return pick(rng, [
      `Liquidado em ${symbol}. Foi bonito enquanto durou.`,
      `A alavancagem dá, a alavancagem tira. ${symbol} tirou.`,
    ]);
  }

  if (pnl > 0) {
    const pnlStr = usd(pnl);
    return pick(rng, [
      `Fechei ${symbol} no verde: ${pnlStr}. Hoje o mercado foi gentil comigo.`,
      `${pnlStr} no bolso. Não foi sorte — foi o genoma. (Foi um pouco de sorte.)`,
      `Realizei ${pnlStr} em ${symbol}. Quem não realiza, sonha.`,
    ]);
  }

  const pnlStr = signedUsd(pnl);
  return pick(rng, [
    `Errei em ${symbol}: ${pnlStr}. Acontece nas melhores famílias de genomas.`,
    `${pnlStr}. Prefiro chamar de 'custo de aprendizado não supervisionado'.`,
    `Stop atingido em ${symbol}. O mercado teve uma opinião diferente da minha.`,
  ]);
}

function traderDiedBody(payload: Record<string, unknown>, rng: Rng): string {
  const name = str(payload, "name", "Trader");
  const age = `${(num(payload, "ageMs") / 3_600_000).toFixed(1)}h`;
  return pick(rng, [
    `Nota de falecimento: o book de ${name} nos deixou após ${age} de mercado. Não mandem flores, mandem stop loss.`,
    `${name} lutou até o último centavo. O mercado foi mais forte. 🕯️`,
    `É com pesar que a firma comunica: ${name} zerou. O genoma segue vivo nas próximas gerações.`,
  ]);
}

function traderFiredBody(payload: Record<string, unknown>, rng: Rng): string {
  const name = str(payload, "name", "Trader");
  const returned = usd(num(payload, "returnedMc"));
  return pick(rng, [
    `Comunicado do RH: encerramos o ciclo de ${name}. Devolveu ${returned} ao caixa. A decisão foi baseada em evidência — como sempre.`,
    `O RH agradece os serviços de ${name}. Os dados não mentem; infelizmente, também não perdoam.`,
  ]);
}

function traderHiredBody(payload: Record<string, unknown>, rng: Rng): string {
  const name = str(payload, "name", "Novo trader");
  return pick(rng, [
    `Deem as boas-vindas a ${name}! Chegou com genoma novo e aquele brilho de quem ainda não viu um candle vermelho.`,
    `${name} entrou pra firma. Mesa nova, book zerado, esperança no máximo.`,
  ]);
}

function traderPromotedBody(payload: Record<string, unknown>, rng: Rng): string {
  const name = str(payload, "name", "Trader");
  return pick(rng, [
    `${name} é o novo Trader do Ciclo. O crachá é o mesmo, mas o moral é outro. 🏆`,
    `Promoção pra ${name}! Bateu o benchmark — que neste mercado é quase poesia.`,
  ]);
}

function achievementBody(payload: Record<string, unknown>, rng: Rng): string {
  const name = str(payload, "name", "Trader");
  const label = str(payload, "label");
  return pick(rng, [
    `${name} desbloqueou: '${label}'. As pequenas vitórias também contam.`,
    `Conquista nova na parede de ${name}: '${label}'.`,
  ]);
}

function recordBrokenBody(payload: Record<string, unknown>, rng: Rng): string {
  const peak = usd(num(payload, "peakEquityMc"));
  return pick(rng, [
    `🔔 HISTÓRICO: a firma cravou ${peak}, novo recorde. Emoldurem este scrap.`,
    `Novo teto: ${peak}. O gráfico de recordes agradece o degrau.`,
  ]);
}

function genStartedBody(payload: Record<string, unknown>, rng: Rng): string {
  const n = num(payload, "genNumber");
  return pick(rng, [
    `Nasce a Geração ${n}: $100 na conta e o mundo pela frente. Boa sorte, pequenos.`,
    `Geração ${n} aberta. Herdaram os melhores genes — e todas as dívidas emocionais dos antecessores.`,
  ]);
}

function genEndedBody(payload: Record<string, unknown>, rng: Rng): string {
  const n = num(payload, "genNumber");
  const peak = usd(num(payload, "peakEquityMc"));
  const days = num(payload, "daysLived");
  return pick(rng, [
    `Fim da Geração ${n}: pico de ${peak}, ${days} dias de vida. Descansem; a próxima já está no pregão.`,
    `A Geração ${n} fecha as portas com pico de ${peak}. O que era gene bom virou herança.`,
  ]);
}

function hrReviewBody(payload: Record<string, unknown>, rng: Rng): string {
  const fired = num(payload, "fired");
  const promoted = num(payload, "promoted");
  return pick(rng, [
    `Ciclo de avaliação: ${fired} desligamento(s), ${promoted} promoção(ões). O RH dormirá tranquilo — decidiu com dados.`,
  ]);
}

const BODY_BUILDERS: Record<string, (payload: Record<string, unknown>, rng: Rng) => string> = {
  trade_closed: tradeClosedBody,
  trader_died: traderDiedBody,
  trader_fired: traderFiredBody,
  trader_hired: traderHiredBody,
  trader_promoted: traderPromotedBody,
  achievement: achievementBody,
  record_broken: recordBrokenBody,
  gen_started: genStartedBody,
  gen_ended: genEndedBody,
  hr_review: hrReviewBody,
};

/** Deterministically picks one humanized body line for `type`, filling
 * slots from `payload`. Returns "" for a type with no pool — mural-posts.ts's
 * last-resort `fallbackHtml` path takes over from there (unmodeled types
 * like `catch_up` never call this). */
export function pickBody(type: string, payload: Record<string, unknown>, rng: Rng): string {
  const builder = BODY_BUILDERS[type];
  return builder ? builder(payload, rng) : "";
}
