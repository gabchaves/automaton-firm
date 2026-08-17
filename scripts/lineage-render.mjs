function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const usd = (c) => `$${(Number(c || 0) / 100).toFixed(2)}`;

export const STYLE = `
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; margin: 2rem auto; max-width: 1180px; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.4rem; margin-bottom: .25rem; }
  .sub { color: #57606a; margin-top: 0; font-size: .9rem; }
  .verdict { padding: .75rem 1rem; border-radius: 8px; margin: 1rem 0; font-weight: 600; }
  .win { background: #dafbe1; color: #1a7f37; }
  .flat { background: #fff1e5; color: #9a6700; }
  table { border-collapse: collapse; width: 100%; font-size: .88rem; }
  th, td { border-bottom: 1px solid #d0d7de; padding: .5rem .6rem; text-align: left; vertical-align: top; }
  th { background: #f6f8fa; font-weight: 600; }
  code { background: #eaeef2; padding: .1rem .35rem; border-radius: 4px; }
  .empty { color: #57606a; font-style: italic; padding: 2rem 0; }
`;

export function renderLineageRows(records) {
  return records
    .map((r) => {
      const e = r.evalResult || {};
      const net = Number(e.realizedPnlCents || 0);
      const color = net > 0 ? "#1a7f37" : net < 0 ? "#cf222e" : "#57606a";
      const kept = r.keptAsIncumbent
        ? '<span style="color:#1a7f37;font-weight:600">ADOTADA</span>'
        : '<span style="color:#57606a">descartada</span>';
      const p = r.params || {};
      const paramStr = `enter ${p.enterFundingBps}bps · exit ${p.exitFundingBps}bps · hold≤${p.maxHoldBars} · cd ${p.minBarsBetweenTrades}`;
      return `<tr>
        <td>${esc(r.generation)}</td>
        <td><code>${esc(r.strategySkill)}</code></td>
        <td>${esc(paramStr)}</td>
        <td style="color:${color};font-weight:600">${usd(net)}</td>
        <td>${usd(e.fundingCollectedCents)}</td>
        <td>${usd(e.feesPaidCents)}</td>
        <td style="text-align:center">${esc(e.closedTrades ?? "—")}</td>
        <td>${kept}</td>
        <td style="max-width:420px">${esc(r.rationale || r.verdictReason || "")}</td>
      </tr>`;
    })
    .join("\n");
}

export function renderLineageBody(records) {
  if (!records || records.length === 0) {
    return '<p class="empty">Nenhuma geração registrada ainda.</p>';
  }
  const anyKept = records.some((r) => r.keptAsIncumbent);
  const verdict = `<div class="verdict ${anyKept ? "win" : "flat"}">${
    anyKept
      ? "✅ Alguma geração bateu a base out-of-sample e foi adotada."
      : "➖ Nenhuma geração bateu a base out-of-sample ainda (resultado válido e honesto)."
  }</div>`;
  return `${verdict}
<table>
  <thead><tr><th>Ger.</th><th>Estratégia</th><th>Params</th><th>Net OOS</th><th>Funding</th><th>Taxas</th><th>Ciclos</th><th>Status</th><th>Racional do CEO</th></tr></thead>
  <tbody>${renderLineageRows(records)}</tbody>
</table>
<p class="sub">${records.length} geração(ões). Net = funding − taxas sobre a janela de avaliação (out-of-sample). v1 assume mark≈spot (basis ignorado).</p>`;
}

export function renderLineageHTML(records) {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Linhagem de Funding-Carry — Firma Autônoma</title>
<style>${STYLE}</style></head><body>
<h1>🧬 Linhagem de Funding-Carry — Firma Autônoma</h1>
<p class="sub">CEO evolui os parâmetros do carry · avaliação out-of-sample · gerado ${new Date().toISOString()}</p>
${renderLineageBody(records)}
</body></html>`;
}
