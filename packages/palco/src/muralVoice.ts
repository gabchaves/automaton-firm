/**
 * Deterministic "humanized" body copy for Mural posts (v3.2 plan, Commit
 * 2 — "mural humanizado"; pools expanded to 4-5 variants per type and the
 * humor sharpened toward the established "darwinismo com CNPJ imaginário"
 * voice in v4's Task B2 — trade_closed's win/loss pools grew again to 8
 * variants each in the v4.2 round, since trade_closed is the highest-
 * frequency event type by far). `pickBody` selects one line from a fixed
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
      `Seleção natural, capítulo alavancagem: ${symbol} venceu essa rodada.`,
      `Rekt em ${symbol}. O mercado não lê currículo genético.`,
    ]);
  }

  if (pnl > 0) {
    const pnlStr = usd(pnl);
    return pick(rng, [
      `Fechei ${symbol} no verde: ${pnlStr}. Hoje o mercado foi gentil comigo.`,
      `${pnlStr} no bolso. Não foi sorte — foi o genoma. (Foi um pouco de sorte.)`,
      `Realizei ${pnlStr} em ${symbol}. Quem não realiza, sonha.`,
      `${pnlStr} de lucro em ${symbol}. Isso vai direto pro currículo genético.`,
      `Bati o mercado em ${symbol}: ${pnlStr}. CNPJ imaginário, resultado real.`,
      `${symbol} pagou bem hoje: ${pnlStr} garantidos, sem estresse extra pro genoma.`,
      `Fechamento redondo em ${symbol}: ${pnlStr}. Não é sorte, é seleção natural funcionando.`,
      `${pnlStr} de saldo positivo em ${symbol}. O book agradece, o genoma se gaba.`,
    ]);
  }

  const pnlStr = signedUsd(pnl);
  return pick(rng, [
    `Errei em ${symbol}: ${pnlStr}. Acontece nas melhores famílias de genomas.`,
    `${pnlStr}. Prefiro chamar de 'custo de aprendizado não supervisionado'.`,
    `Stop atingido em ${symbol}. O mercado teve uma opinião diferente da minha.`,
    `${pnlStr} em ${symbol}. Um dia de cada vez na luta contra a extinção.`,
    `Doeu ${pnlStr} em ${symbol}. Já foi anotado no relatório de evidências do RH.`,
    `${pnlStr} em ${symbol}: o mercado corrigiu meu excesso de confiança.`,
    `Perda de ${pnlStr} em ${symbol}. O genoma anota e segue — evidência é evidência.`,
    `${pnlStr} no vermelho em ${symbol}. Fica pro próximo ciclo de avaliação.`,
  ]);
}

function traderDiedBody(payload: Record<string, unknown>, rng: Rng): string {
  const name = str(payload, "name", "Trader");
  const age = `${(num(payload, "ageMs") / 3_600_000).toFixed(1)}h`;
  return pick(rng, [
    `Nota de falecimento: o book de ${name} nos deixou após ${age} de mercado. Não mandem flores, mandem stop loss.`,
    `${name} lutou até o último centavo. O mercado foi mais forte. 🕯️`,
    `É com pesar que a firma comunica: ${name} zerou. O genoma segue vivo nas próximas gerações.`,
    `${name} não resistiu a ${age} de volatilidade. Os pêsames já saem em nome da seleção natural.`,
  ]);
}

function traderFiredBody(payload: Record<string, unknown>, rng: Rng): string {
  const name = str(payload, "name", "Trader");
  const returned = usd(num(payload, "returnedMc"));
  return pick(rng, [
    `Comunicado do RH: encerramos o ciclo de ${name}. Devolveu ${returned} ao caixa. A decisão foi baseada em evidência — como sempre.`,
    `O RH agradece os serviços de ${name}. Os dados não mentem; infelizmente, também não perdoam.`,
    `${name} foi desligado(a) com ${returned} de saldo devolvido. Sem drama: é darwinismo com CNPJ imaginário.`,
    `Fim de linha pra ${name}: ${returned} de volta pro caixa. A planilha de evidências não teve pena.`,
  ]);
}

function traderHiredBody(payload: Record<string, unknown>, rng: Rng): string {
  const name = str(payload, "name", "Novo trader");
  return pick(rng, [
    `Deem as boas-vindas a ${name}! Chegou com genoma novo e aquele brilho de quem ainda não viu um candle vermelho.`,
    `${name} entrou pra firma. Mesa nova, book zerado, esperança no máximo.`,
    `Novo CNPJ imaginário na folha: ${name}. Que a seleção natural seja gentil.`,
    `${name} assinou o contrato genético. Bem-vindo(a) à fila da avaliação semanal.`,
  ]);
}

function traderPromotedBody(payload: Record<string, unknown>, rng: Rng): string {
  const name = str(payload, "name", "Trader");
  return pick(rng, [
    `${name} é o novo Trader do Ciclo. O crachá é o mesmo, mas o moral é outro. 🏆`,
    `Promoção pra ${name}! Bateu o benchmark — que neste mercado é quase poesia.`,
    `${name} subiu de posto. A evidência favoreceu, o RH aplaudiu.`,
    `Reconhecimento oficial pra ${name}: melhor genoma do ciclo, sem discussão.`,
  ]);
}

function achievementBody(payload: Record<string, unknown>, rng: Rng): string {
  const name = str(payload, "name", "Trader");
  const label = str(payload, "label");
  return pick(rng, [
    `${name} desbloqueou: '${label}'. As pequenas vitórias também contam.`,
    `Conquista nova na parede de ${name}: '${label}'.`,
    `${name} cravou '${label}'. Mais uma linha bonita na ficha genética.`,
    `Placar atualizado: ${name} garantiu '${label}'.`,
  ]);
}

function recordBrokenBody(payload: Record<string, unknown>, rng: Rng): string {
  const peak = usd(num(payload, "peakEquityMc"));
  return pick(rng, [
    `🔔 HISTÓRICO: a firma cravou ${peak}, novo recorde. Emoldurem este scrap.`,
    `Novo teto: ${peak}. O gráfico de recordes agradece o degrau.`,
    `${peak} no topo da história. A firma evoluiu de novo, com CNPJ e tudo.`,
    `Recorde batido: ${peak}. O eletrocardiograma do experimento deu um pulo.`,
  ]);
}

function genStartedBody(payload: Record<string, unknown>, rng: Rng): string {
  const n = num(payload, "genNumber");
  return pick(rng, [
    `Nasce a Geração ${n}: banca cheia e o mundo pela frente. Boa sorte, pequenos.`,
    `Geração ${n} aberta. Herdaram os melhores genes — e todas as dívidas emocionais dos antecessores.`,
    `Novo CNPJ imaginário fundado: Geração ${n}. Que a seleção natural comece.`,
    `Geração ${n} no ar. Genoma fresco, book cheio, relógio da avaliação já correndo.`,
  ]);
}

function genEndedBody(payload: Record<string, unknown>, rng: Rng): string {
  const n = num(payload, "genNumber");
  const peak = usd(num(payload, "peakEquityMc"));
  const days = num(payload, "daysLived");
  return pick(rng, [
    `Fim da Geração ${n}: pico de ${peak}, ${days} dias de vida. Descansem; a próxima já está no pregão.`,
    `A Geração ${n} fecha as portas com pico de ${peak}. O que era gene bom virou herança.`,
    `Geração ${n} encerrada após ${days} dias: pico de ${peak}. Extinção com dignidade.`,
    `${days} dias de Geração ${n}, pico ${peak}. O funeral é rápido; a herança genética, não.`,
  ]);
}

function hrReviewBody(payload: Record<string, unknown>, rng: Rng): string {
  const fired = num(payload, "fired");
  const promoted = num(payload, "promoted");
  return pick(rng, [
    `Ciclo de avaliação: ${fired} desligamento(s), ${promoted} promoção(ões). O RH dormirá tranquilo — decidiu com dados.`,
    `Fechamos o ciclo: ${fired} fora, ${promoted} promovido(s). Tudo baseado em evidência, nada em achismo.`,
    `Relatório do RH: ${fired} desligamento(s) e ${promoted} promoção(ões) neste ciclo. A planilha manda.`,
    `Avaliação encerrada: ${fired} saíram, ${promoted} subiram. Seleção natural com ata assinada.`,
  ]);
}

/** Rotation is evidence-blind by design — the voice must never sound like a
 * performance verdict, or the front would misrepresent the HR rule. Every
 * variant below names the absence of evidence explicitly, so the "never a
 * verdict" guarantee holds regardless of which line the seed picks. */
function traderRotatedBody(payload: Record<string, unknown>, rng: Rng): string {
  const name = str(payload, "name", "O trader");
  return pick(rng, [
    `O RH girou a cadeira de ${name}: sem trades suficientes pra julgar, sem evidência pra carregar. Entra genoma novo.`,
    `${name} saiu sem vermelho no histórico — e sem histórico. A firma precisa de evidência, não de mistério.`,
    `Cadeira de ${name} girou por falta de evidência, não por falta de resultado. Ninguém foi julgado aqui.`,
    `Rotação de ${name}: pouca evidência pra qualquer veredito. O RH só girou a cadeira, não deu nota.`,
  ]);
}

const BODY_BUILDERS: Record<string, (payload: Record<string, unknown>, rng: Rng) => string> = {
  trade_closed: tradeClosedBody,
  trader_died: traderDiedBody,
  trader_fired: traderFiredBody,
  trader_rotated: traderRotatedBody,
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

/** Exported so tests can assert every pool has the v4 plan's minimum
 * variant count (>=4) without hardcoding each builder's pool inline —
 * pulls the pool by calling the builder with a `rng` that always selects
 * index 0, then re-derives the count via a full 0..1 sweep isn't needed:
 * each builder is deterministic in POOL SIZE regardless of payload/rng, so
 * a fixed representative payload per type is enough to read `pool.length`
 * indirectly through `poolSizeFor`. */
const REPRESENTATIVE_PAYLOAD: Record<string, Record<string, unknown>> = {
  trade_closed: { symbol: "BTCUSDT", realizedPnlMc: 100_000 },
  trader_died: { name: "Trader", ageMs: 3_600_000 },
  trader_fired: { name: "Trader", returnedMc: 0 },
  trader_rotated: { name: "Trader" },
  trader_hired: { name: "Trader" },
  trader_promoted: { name: "Trader" },
  achievement: { name: "Trader", label: "x" },
  record_broken: { peakEquityMc: 0 },
  gen_started: { genNumber: 1 },
  gen_ended: { genNumber: 1, peakEquityMc: 0, daysLived: 1 },
  hr_review: { fired: 0, promoted: 0 },
};

/** Number of distinct body lines `pickBody` can produce for `type`, found
 * by sampling every pick index (0..n-1 maps to rng() in [i/n, (i+1)/n)) and
 * counting distinct outputs. Used by the pool-size regression test (v4
 * Task B2: "every pool has >= 4 variants") instead of hardcoding each
 * pool's literal contents in the test file, which would duplicate this
 * module and drift the moment a line's wording changes. */
export function poolSizeFor(type: string, maxProbe = 8): number {
  const payload = REPRESENTATIVE_PAYLOAD[type];
  if (!payload) return 0;
  const seen = new Set<string>();
  for (let i = 0; i < maxProbe; i++) {
    const fraction = (i + 0.5) / maxProbe;
    seen.add(pickBody(type, payload, () => fraction));
  }
  return seen.size;
}
