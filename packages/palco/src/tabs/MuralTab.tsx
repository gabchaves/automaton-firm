import { useEffect, useRef, useState } from "react";
import type { PalcoSnapshot } from "../types";
import { dateShort } from "../format";

interface MuralTabProps {
  snapshot: PalcoSnapshot | null;
}

export function MuralTab({ snapshot }: MuralTabProps) {
  const prevIdsRef = useRef<Set<number>>(new Set());
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  const feed = snapshot?.feed ?? [];

  useEffect(() => {
    const currentIds = new Set(feed.map((item) => item.id));
    const prevIds = prevIdsRef.current;
    const fresh = new Set<number>();
    for (const id of currentIds) {
      if (!prevIds.has(id)) fresh.add(id);
    }
    // Only highlight items that arrived after the first snapshot — the
    // initial population of the mural shouldn't fade-in as "new".
    if (prevIds.size > 0) setNewIds(fresh);
    prevIdsRef.current = currentIds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.lastEventId]);

  return (
    <ul className="mural-feed">
      {feed.length === 0 && <li>Sem eventos ainda.</li>}
      {feed.map((item) => (
        <li key={item.id} className={newIds.has(item.id) ? "fade-highlight" : undefined}>
          <span className="ts">{dateShort(item.ts)}</span>
          {/*
            dangerouslySetInnerHTML is ACCEPTABLE here ONLY because
            item.html is produced server-side by
            src/motor/palco-format.ts's formatEventPt, which escapes every
            payload value through escapeHtml before interpolation. No
            client-supplied or unescaped string ever reaches this prop.
          */}
          <span dangerouslySetInnerHTML={{ __html: item.html }} />
        </li>
      ))}
    </ul>
  );
}
