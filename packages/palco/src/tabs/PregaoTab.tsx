import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";
import type { PalcoSnapshot } from "../types";
import { dateShort } from "../format";

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend);

const DARK_GREEN = "#58a27a";
const DARK_MUTED = "#8f8d82";
const DARK_BASELINE = "#4a4943";
const DARK_GRID = "#2c2b27";
const BASELINE_USD = 10;
const MAX_TRADE_ITEMS = 12;

interface PregaoTabProps {
  snapshot: PalcoSnapshot | null;
}

function toPoints(series: [number, number][]): { x: number; y: number }[] {
  return series.map(([ts, mc]) => ({ x: ts, y: mc / 100_000 }));
}

/** Green/red row tint for the compact trades list, based on realizedPnlMc.
 * trade_opened rows (no pnl yet) and exact-zero pnl stay neutral. */
function pnlRowClass(item: { type: string; payload: Record<string, unknown> }): string {
  if (item.type !== "trade_closed") return "";
  const pnl = item.payload.realizedPnlMc;
  if (typeof pnl !== "number") return "";
  if (pnl > 0) return "pnl-pos";
  if (pnl < 0) return "pnl-neg";
  return "";
}

export function PregaoTab({ snapshot }: PregaoTabProps) {
  const evolvedPoints = toPoints(snapshot?.equitySeries.evolved ?? []);
  const randomPoints = toPoints(snapshot?.equitySeries.random ?? []);
  const allTs = [...evolvedPoints, ...randomPoints].map((p) => p.x);
  const minTs = allTs.length ? Math.min(...allTs) : 0;
  const maxTs = allTs.length ? Math.max(...allTs) : 1;

  const data = {
    datasets: [
      {
        label: "firma",
        data: evolvedPoints,
        borderColor: DARK_GREEN,
        backgroundColor: DARK_GREEN,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.15,
      },
      {
        label: "controle aleatório",
        data: randomPoints,
        borderColor: DARK_MUTED,
        backgroundColor: DARK_MUTED,
        borderWidth: 1.5,
        borderDash: [4, 4],
        pointRadius: 0,
        tension: 0.15,
      },
      {
        label: "$10 parado",
        data: [
          { x: minTs, y: BASELINE_USD },
          { x: maxTs, y: BASELINE_USD },
        ],
        borderColor: DARK_BASELINE,
        borderDash: [2, 3],
        borderWidth: 1,
        pointRadius: 0,
      },
    ],
  };

  const options = {
    responsive: true,
    scales: {
      x: {
        type: "linear" as const,
        ticks: { callback: (value: number | string) => dateShort(Number(value)), color: DARK_MUTED },
        grid: { color: DARK_GRID },
      },
      y: {
        ticks: { callback: (value: number | string) => `$${value}`, color: DARK_MUTED },
        grid: { color: DARK_GRID },
      },
    },
    plugins: {
      legend: { labels: { color: DARK_MUTED, font: { family: "Verdana" } } },
    },
  };

  const trades = (snapshot?.feed ?? []).filter(
    (item) => item.type === "trade_opened" || item.type === "trade_closed",
  );

  return (
    <div>
      <h2 className="label">Curva de equity</h2>
      <Line data={data} options={options} />

      <hr />

      <h2 className="label">Últimos trades</h2>
      <ul className="trade-feed">
        {trades.length === 0 && <li>Sem trades ainda.</li>}
        {trades.slice(0, MAX_TRADE_ITEMS).map((item) => (
          <li key={item.id} className={pnlRowClass(item)}>
            <span className="ts">{dateShort(item.ts)}</span>
            {/*
              Safe: item.html is produced server-side by
              src/motor/palco-format.ts's formatEventPt, which escapes every
              payload value through escapeHtml before interpolation. This is
              the same trusted, pre-escaped field the Mural tab renders.
            */}
            <span dangerouslySetInnerHTML={{ __html: item.html }} />
          </li>
        ))}
      </ul>
    </div>
  );
}
