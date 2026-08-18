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
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
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

const HARVEY_GREEN = "#1e3d2f";
const HARVEY_MUTED = "#8a8a7d";
const HARVEY_BASELINE = "#b8b4a6";
const BASELINE_USD = 10;

interface GeracoesTabProps {
  snapshot: PalcoSnapshot | null;
}

export function GeracoesTab({ snapshot }: GeracoesTabProps) {
  const generations = snapshot?.generations ?? [];
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
      y: { ticks: { callback: (value) => `$${value}` }, grid: { color: "#eae7dd" } },
    },
    plugins: {
      legend: { labels: { color: HARVEY_MUTED, font: { family: "Verdana" } } },
    },
  };

  const rows = generations.map((g) => ({ ...g, id: `${g.cohort}-${g.genNumber}` }));

  return (
    <div>
      <h2 className="label">Recorde por geração</h2>
      <Chart
        type="bar"
        // chart.js supports mixing a "line" dataset (the $10 baseline) into
        // an otherwise "bar" chart at runtime; react-chartjs-2's types don't
        // model that mix for a single `type="bar"` chart, so this cast is a
        // narrow, deliberate escape hatch — the JS shape below is valid.
        data={
          {
            labels: genNumbers.map((n) => `G${n}`),
            datasets: [
              { type: "bar", label: "firma", data: evolvedData, backgroundColor: HARVEY_GREEN },
              { type: "bar", label: "controle aleatório", data: randomData, backgroundColor: HARVEY_MUTED },
              {
                type: "line",
                label: "$10 parado",
                data: baselineData,
                borderColor: HARVEY_BASELINE,
                borderDash: [2, 3],
                borderWidth: 1,
                pointRadius: 0,
              },
            ],
          } as unknown as ChartData<"bar", (number | null)[], string>
        }
        options={options}
      />

      <hr />

      <h2 className="label">Todas as gerações</h2>
      <DataTable value={rows} dataKey="id">
        <Column
          header="Time"
          body={(row) => (
            <Tag
              value={row.cohort === "evolved" ? "firma" : "controle"}
              severity={row.cohort === "evolved" ? "success" : "secondary"}
            />
          )}
        />
        <Column header="Gen" body={(row) => `G${row.genNumber}`} />
        <Column header="Pico" body={(row) => usd(row.peakEquityMc)} />
        <Column header="Barras" field="barsLived" />
        <Column header="Status" body={(row) => (row.ended ? "encerrada" : "em curso")} />
      </DataTable>
    </div>
  );
}
