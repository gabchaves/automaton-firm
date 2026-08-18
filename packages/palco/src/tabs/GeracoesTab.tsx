import {
  Chart as ChartJS,
  BarElement,
  BarController,
  LineElement,
  LineController,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { Chart } from "react-chartjs-2";
import { Tag } from "primereact/tag";
import type { PalcoSnapshot } from "../types";
import { usd } from "../format";

ChartJS.register(
  BarElement,
  BarController,
  LineElement,
  LineController,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
);

// pxpush identity chart palette — mirrors theme.css's --green/--lightgrey
// tokens (chart.js reads plain CSS color strings, not custom properties,
// so these are kept in sync by hand). Per the plan: firm curve is
// terminal green, control is dashed lightgrey, the $10 baseline is a
// faint dashed white hairline.
const FIRM_GREEN = "#0f0";
const CONTROL_GREY = "#71737d";
const BASELINE_HAIRLINE = "hsla(0, 0%, 100%, 0.35)";
const MUTED_TEXT = "#71737d";
const GRID_HAIRLINE = "hsla(0, 0%, 100%, 0.08)";
const MONO_FONT = "'Geist Mono', Consolas, monospace";
const BASELINE_USD = 10;

// 5-minute bars — same constant as src/motor/feed.ts's BAR_MS. Not exposed
// on PalcoSnapshot.generations, so "dias vividos" is approximated from
// barsLived instead of a real elapsed-time field.
const BAR_MS = 300_000;
const MS_PER_DAY = 86_400_000;

interface GeracoesTabProps {
  snapshot: PalcoSnapshot | null;
}

const EXPLAINER =
  "Cada barra é o pico que uma geração de $10 alcançou antes de morrer. Verde = firma; cinza = controle. Se a firma evolui de verdade, as barras verdes sobem com o tempo.";

function daysLivedFrom(barsLived: number): string {
  return ((barsLived * BAR_MS) / MS_PER_DAY).toFixed(1);
}

export function GeracoesTab({ snapshot }: GeracoesTabProps) {
  const generations = snapshot?.generations ?? [];
  const cards = snapshot?.cards;
  const genNumbers = Array.from(new Set(generations.map((g) => g.genNumber))).sort((a, b) => a - b);
  const evolvedByGen = new Map(generations.filter((g) => g.cohort === "evolved").map((g) => [g.genNumber, g]));
  const randomByGen = new Map(generations.filter((g) => g.cohort === "random").map((g) => [g.genNumber, g]));

  const evolvedData = genNumbers.map((n) => {
    const gen = evolvedByGen.get(n);
    return gen ? gen.peakEquityMc / 100_000 : null;
  });
  const randomData = genNumbers.map((n) => {
    const gen = randomByGen.get(n);
    return gen ? gen.peakEquityMc / 100_000 : null;
  });
  const baselineData = genNumbers.map(() => BASELINE_USD);

  const options: ChartOptions<"bar"> = {
    responsive: true,
    scales: {
      x: { ticks: { color: MUTED_TEXT, font: { family: MONO_FONT } }, grid: { color: GRID_HAIRLINE } },
      y: {
        ticks: { callback: (value) => `$${value}`, color: MUTED_TEXT, font: { family: MONO_FONT } },
        grid: { color: GRID_HAIRLINE },
      },
    },
    plugins: {
      legend: { labels: { color: MUTED_TEXT, font: { family: MONO_FONT } } },
    },
  };

  return (
    <div>
      <h2 className="section-title">Recorde por geração</h2>
      <Chart
        type="bar"
        // chart.js supports mixing "line" datasets (controle + the $10
        // baseline) into an otherwise "bar" chart at runtime;
        // react-chartjs-2's types don't model that mix for a single
        // type="bar" chart, so this cast is a narrow, deliberate escape
        // hatch — the JS shape below is valid.
        data={
          {
            labels: genNumbers.map((n) => `G${n}`),
            datasets: [
              { type: "bar", label: "firma", data: evolvedData, backgroundColor: FIRM_GREEN },
              {
                type: "line",
                label: "controle aleatório",
                data: randomData,
                borderColor: CONTROL_GREY,
                borderDash: [4, 4],
                borderWidth: 1.5,
                pointRadius: 2,
                pointBackgroundColor: CONTROL_GREY,
              },
              {
                type: "line",
                label: "$10 parado",
                data: baselineData,
                borderColor: BASELINE_HAIRLINE,
                borderDash: [2, 3],
                borderWidth: 1,
                pointRadius: 0,
              },
            ],
          } as unknown as ChartData<"bar", (number | null)[], string>
        }
        options={options}
      />

      <p className="gen-explainer">{EXPLAINER}</p>

      <h2 className="section-title">Todas as gerações</h2>
      <div className="gen-timeline">
        {generations.length === 0 && <p>Sem gerações ainda.</p>}
        {generations.map((gen) => {
          const recordMc = gen.cohort === "evolved" ? (cards?.recordEvolvedMc ?? 0) : (cards?.recordRandomMc ?? 0);
          const isRecord = recordMc > 0 && gen.peakEquityMc === recordMc;
          const progressPct = recordMc > 0 ? Math.min(100, (gen.peakEquityMc / recordMc) * 100) : 0;

          return (
            <div key={`${gen.cohort}-${gen.genNumber}`} className="gen-card">
              <div className="gen-card-top">
                <span className="gen-card-title">Geração {gen.genNumber}</span>
                <span className={gen.ended ? "status-chip status-neutral" : "status-chip status-live"}>
                  {gen.ended ? "encerrada" : "em curso"}
                </span>
                <Tag
                  value={gen.cohort === "evolved" ? "firma" : "controle"}
                  severity={gen.cohort === "evolved" ? "success" : "secondary"}
                />
                {isRecord && <span className="gen-record-badge">🔔 recorde</span>}
              </div>
              <div className="peak">{usd(gen.peakEquityMc)}</div>
              <div className="label">
                {daysLivedFrom(gen.barsLived)} dias vividos · {gen.barsLived} barras
              </div>
              <div className="gen-progress">
                <div className="gen-progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
