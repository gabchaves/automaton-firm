function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function money(cents) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((cents ?? 0) / 100);
}

function shortId(id) {
  const text = String(id ?? "");
  return text.length > 10 ? text.slice(0, 10) : text;
}

function pnlClass(cents) {
  if ((cents ?? 0) > 0) return "positive";
  if ((cents ?? 0) < 0) return "negative";
  return "neutral";
}

function summaryCard(label, value) {
  return `<section class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></section>`;
}

export function renderDashboardHtml(data, generatedAt) {
  const summary = data.summary ?? {};
  const traders = data.traders ?? [];
  const orders = data.orders ?? [];
  const journals = data.journals ?? [];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Firm Dashboard</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #101114;
      --panel: #181b20;
      --line: #2a3038;
      --text: #f1f3f5;
      --muted: #a5adba;
      --green: #6bd78b;
      --red: #ff7a7a;
      --accent: #8ab4ff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    main {
      width: min(1180px, calc(100% - 32px));
      margin: 0 auto;
      padding: 28px 0 44px;
    }
    header {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 24px;
    }
    h1, h2 { margin: 0; letter-spacing: 0; }
    h1 { font-size: 28px; }
    h2 { font-size: 18px; margin: 28px 0 10px; }
    .stamp { color: var(--muted); font-size: 13px; }
    .metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
    }
    .metric {
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 8px;
      padding: 12px 14px;
    }
    .metric span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
    }
    .metric strong {
      display: block;
      margin-top: 4px;
      font-size: 20px;
    }
    .table-wrap {
      overflow-x: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 760px;
    }
    th, td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      white-space: nowrap;
      font-size: 14px;
    }
    th {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0;
    }
    tr:last-child td { border-bottom: 0; }
    .positive { color: var(--green); }
    .negative { color: var(--red); }
    .neutral { color: var(--muted); }
    .dimmed { opacity: 0.48; }
    .tag {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 999px;
      border: 1px solid var(--line);
      color: var(--accent);
      font-size: 12px;
    }
    .journals {
      display: grid;
      gap: 10px;
    }
    .journal {
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 8px;
      padding: 12px 14px;
    }
    .journal-title {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      color: var(--muted);
      font-size: 13px;
      margin-bottom: 6px;
    }
    .journal p {
      margin: 0;
      color: var(--text);
      font-size: 14px;
      white-space: pre-wrap;
    }
    .empty {
      color: var(--muted);
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 8px;
      padding: 14px;
    }
    @media (max-width: 640px) {
      main { width: min(100% - 20px, 1180px); padding-top: 18px; }
      header { display: block; }
      .stamp { margin-top: 6px; }
      h1 { font-size: 24px; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Firm Dashboard</h1>
        <div class="stamp">Generated at ${escapeHtml(generatedAt)}</div>
      </div>
    </header>

    <div class="metrics">
      ${summaryCard("Live seniors", summary.liveSeniors ?? 0)}
      ${summaryCard("Live interns", summary.liveInterns ?? 0)}
      ${summaryCard("Dead", summary.dead ?? 0)}
      ${summaryCard("Total realized PnL", money(summary.totalRealizedPnlCents))}
      ${summaryCard("Total live book cash", money(summary.totalBookCents))}
    </div>

    <h2>Traders</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Role</th>
            <th>Generation</th>
            <th>Status</th>
            <th>Book</th>
            <th>Realized PnL</th>
            <th>Parent</th>
          </tr>
        </thead>
        <tbody>
          ${traders.map((trader) => `
          <tr>
            <td>${escapeHtml(shortId(trader.id))}</td>
            <td>${escapeHtml(trader.name)}</td>
            <td><span class="tag">${escapeHtml(trader.role)}</span></td>
            <td>${escapeHtml(trader.generation)}</td>
            <td>${escapeHtml(trader.status)}</td>
            <td>${money(trader.bookBalanceCents)}</td>
            <td class="${pnlClass(trader.realizedPnlCents)}">${money(trader.realizedPnlCents)}</td>
            <td>${escapeHtml(trader.parentId ? shortId(trader.parentId) : "")}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>

    <h2>Recent Orders</h2>
    ${orders.length > 0 ? `<div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Trader</th>
            <th>Symbol</th>
            <th>Side</th>
            <th>Qty</th>
            <th>Price</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${orders.map((order) => `
          <tr class="${order.status === "rejected" ? "dimmed" : ""}">
            <td>${escapeHtml(order.createdAt)}</td>
            <td>${escapeHtml(shortId(order.traderId))}</td>
            <td>${escapeHtml(order.symbol)}</td>
            <td>${escapeHtml(order.side)}</td>
            <td>${escapeHtml(order.size)}</td>
            <td>${money(order.priceCents)}</td>
            <td>${escapeHtml(order.status)}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>` : `<div class="empty">No recent orders.</div>`}

    <h2>Recent Journals</h2>
    ${journals.length > 0 ? `<div class="journals">
      ${journals.map((journal) => `
      <article class="journal">
        <div class="journal-title">
          <strong>${escapeHtml(journal.filename)}</strong>
          <span>${escapeHtml(journal.modifiedAt ?? "")}</span>
        </div>
        <p>${escapeHtml(journal.body)}</p>
      </article>`).join("")}
    </div>` : `<div class="empty">No journal files found.</div>`}
  </main>
</body>
</html>`;
}
