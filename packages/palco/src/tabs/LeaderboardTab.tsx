import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import type { PalcoSnapshot } from "../types";
import { usd } from "../format";

interface LeaderboardTabProps {
  snapshot: PalcoSnapshot | null;
}

const STATUS_PT: Record<string, string> = {
  live: "vivo",
  dead: "morto",
  fired: "demitido",
};

const STATUS_ICON: Record<string, string> = {
  dead: "💀",
  fired: "📦",
};

export function LeaderboardTab({ snapshot }: LeaderboardTabProps) {
  const rows = (snapshot?.leaderboard ?? []).map((trader, index) => ({
    ...trader,
    rank: index + 1,
    id: `${trader.cohort}-${trader.genNumber}-${trader.name}-${index}`,
  }));

  return (
    <DataTable value={rows} dataKey="id" className="leaderboard-table">
      <Column header="#" body={(row) => row.rank} style={{ width: "3rem" }} />
      <Column header="Nome" field="name" />
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
      <Column
        header="Status"
        body={(row) => (
          <span>
            {STATUS_ICON[row.status] ?? ""} {STATUS_PT[row.status] ?? row.status}
          </span>
        )}
      />
      <Column header="Book" body={(row) => usd(row.bookMc)} />
      <Column header="P&L" body={(row) => usd(row.realizedPnlMc)} />
      <Column header="Trades" field="tradesCount" />
      <Column header="Mesa" body={(row) => `${row.symbol} · ${row.leverage}x`} />
      <Column header="Genoma" body={(row) => <span className="genes">{row.genes}</span>} />
      <Column
        header="Conquistas"
        body={(row) => (
          <span className="achievements">
            {row.achievements.map((label: string, index: number) => (
              <span key={`${row.id}-${index}`} className="badge" title={label}>
                ✨
              </span>
            ))}
          </span>
        )}
      />
    </DataTable>
  );
}
