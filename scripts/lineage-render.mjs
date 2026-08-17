export function esc(s) {
  return String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
const usd = (c) => `$${(Number(c || 0) / 100).toFixed(2)}`;
const pnlClass = (c) => (Number(c || 0) > 0 ? "positive" : Number(c || 0) < 0 ? "negative" : "neutral");

// Consolidated dark dashboard, matching the firm-dashboard look: metric cards on
// top, then a single lineage table. Shared by the static generator and the live
// SSE server so both views are identical.
export const STYLE = `
  :root {
    color-scheme: light dark;
    --bg: #101114; --panel: #181b20; --line: #2a3038;
    --text: #f1f3f5; --muted: #a5adba;
    --green: #6bd78b; --red: #ff7a7a; --accent: #8ab4ff;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; }
  main { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 44px; }
  header { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
  h1 { font-size: 26px; margin: 0; }
  h2 { font-size: 17px; margin: 26px 0 10px; }
  .stamp { color: var(--muted); font-size: 13px; }
  .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
  .metric { border: 1px solid var(--line); background: var(--panel); border-radius: 8px; padding: 12px 14px; }
  .metric span { display: block; color: var(--muted); font-size: 12px; text-transform: uppercase; }
  .metric strong { display: block; margin-top: 4px; font-size: 20px; }
  .verdict { margin: 18px 0 4px; padding: 10px 14px; border-radius: 8px; border: 1px solid var(--line); background: var(--panel); font-weight: 600; }
  .verdict.win { color: var(--green); }
  .verdict.flat { color: var(--muted); }
  .table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
  table { width: 100%; border-collapse: collapse; min-width: 820px; }
  th, td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; font-size: 14px; vertical-align: top; }
  th { color: var(--muted); font-size: 12px; text-transform: uppercase; }
  tr:last-child td { border-bottom: 0; }
  .positive { color: var(--green); }
  .negative { color: var(--red); }
  .neutral { color: var(--muted); }
  code { background: #11141a; border: 1px solid var(--line); padding: 1px 6px; border-radius: 4px; font-size: 12px; }
  .tag { display: inline-block; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line); font-size: 12px; }
  .tag.kept { color: var(--green); }
  .tag.dropped { color: var(--muted); }
  .empty { color: var(--muted); border: 1px solid var(--line); background: var(--panel); border-radius: 8px; padding: 16px; }
  .note { color: var(--muted); font-size: 12px; margin-top: 14px; }
`;

function metricCard(label, value, cls = "") {
  return `<section class="metric"><span>${esc(label)}</span><strong class="${cls}">${esc(value)}</strong></section>`;
}

export function renderLineageRows(records) {
  return records
    .map((r) => {
      const e = r.evalResult || {};
      const p = r.params || {};
      const paramStr = `enter ${p.enterFundingBps}bps · exit ${p.exitFundingBps}bps · hold≤${p.maxHoldBars} · cd ${p.minBarsBetweenTrades}`;
      const kept = r.keptAsIncumbent
        ? '<span class="tag kept">ADOTADA</span>'
        : '<span class="tag dropped">descartada</span>';
      return `<tr>
        <td>${esc(r.generation)}</td>
        <td><code>${esc(r.strategySkill)}</code></td>
        <td>${esc(paramStr)}</td>
        <td class="${pnlClass(e.realizedPnlCents)}">${usd(e.realizedPnlCents)}</td>
        <td>${usd(e.fundingCollectedCents)}</td>
        <td>${usd(e.feesPaidCents)}</td>
        <td style="text-align:center">${esc(e.closedTrades ?? "—")}</td>
        <td>${kept}</td>
        <td style="max-width:360px;white-space:normal">${esc(r.rationale || r.verdictReason || "")}</td>
      </tr>`;
    })
    .join("\n");
}

export function renderLineageBody(records) {
  if (!records || records.length === 0) {
    return '<div class="empty">Nenhuma geração registrada ainda. Aguardando a primeira…</div>';
  }
  const adopted = records.filter((r) => r.keptAsIncumbent).length;
  const nets = records.map((r) => Number(r.evalResult?.realizedPnlCents || 0));
  const bestNet = Math.max(...nets);
  const bestGen = records[nets.indexOf(bestNet)];
  const totalFunding = records.reduce((s, r) => s + Number(r.evalResult?.fundingCollectedCents || 0), 0);
  const maxCycles = Math.max(...records.map((r) => Number(r.evalResult?.closedTrades || 0)));
  const anyKept = adopted > 0;

  const metrics = `<div class="metrics">
    ${metricCard("Gerações", records.length)}
    ${metricCard("Adotadas", adopted)}
    ${metricCard("Melhor net OOS", usd(bestNet), pnlClass(bestNet))}
    ${metricCard("Funding coletado", usd(totalFunding))}
    ${metricCard("Ciclos (máx/ger)", maxCycles)}
  </div>`;

  const verdict = `<div class="verdict ${anyKept ? "win" : "flat"}">${
    anyKept
      ? `✅ Melhor geração bateu a base out-of-sample (ger. ${esc(bestGen.generation)}, net ${usd(bestNet)}).`
      : "➖ Nenhuma geração bateu a base out-of-sample ainda — resultado válido e honesto."
  }</div>`;

  const table = `<h2>Linhagem por geração</h2>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Ger.</th><th>Estratégia</th><th>Params (timing)</th><th>Net OOS</th><th>Funding</th><th>Taxas</th><th>Ciclos</th><th>Status</th><th>Racional do CEO</th></tr></thead>
      <tbody>${renderLineageRows(records)}</tbody>
    </table>
  </div>
  <p class="note">Net = funding − taxas sobre a janela de avaliação (out-of-sample). Size é fixo (metade do capital); o CEO evolui só timing. v1 assume mark≈spot (basis ignorado).</p>`;

  return `${metrics}${verdict}${table}`;
}

export function renderLineageHTML(records) {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Funding-Carry — Firma Autônoma</title>
<style>${STYLE}</style></head><body>
<main>
  <header>
    <div>
      <h1>🧬 Linhagem de Funding-Carry</h1>
      <div class="stamp">CEO evolui o timing do carry · avaliação out-of-sample · gerado ${new Date().toISOString()}</div>
    </div>
  </header>
  ${renderLineageBody(records)}
</main>
</body></html>`;
}
