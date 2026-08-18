import { useEffect, useState } from "react";
import type { PalcoSnapshot } from "./types";

export interface UseSnapshotResult {
  snapshot: PalcoSnapshot | null;
  connected: boolean;
}

/**
 * Owns the realtime connection to the Palco server: an initial
 * `/api/snapshot` fetch (so the page has data before the stream opens),
 * then an `EventSource("/events")` that replaces the whole snapshot on
 * every `message` (the server pushes full snapshots, not diffs — see
 * the design spec §2). `connected` reflects the EventSource's open/error
 * state; the browser's EventSource auto-reconnects on its own, so no
 * manual retry logic is needed here.
 */
export function useSnapshot(): UseSnapshotResult {
  const [snapshot, setSnapshot] = useState<PalcoSnapshot | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/snapshot")
      .then((res) => res.json())
      .then((data: PalcoSnapshot) => {
        if (!cancelled) setSnapshot(data);
      })
      .catch(() => {
        // The EventSource below will populate the snapshot once it
        // connects; a failed initial fetch is not fatal on its own.
      });

    const source = new EventSource("/events");

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (event: MessageEvent<string>) => {
      try {
        setSnapshot(JSON.parse(event.data) as PalcoSnapshot);
      } catch {
        // Ignore malformed frames (e.g. heartbeat comments never reach
        // onmessage, but stay defensive against bad payloads).
      }
    };

    return () => {
      cancelled = true;
      source.close();
    };
  }, []);

  return { snapshot, connected };
}
