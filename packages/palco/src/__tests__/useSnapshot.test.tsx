import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useSnapshot } from "../useSnapshot";
import { fixtureSnapshot } from "./fixtures";

class StubEventSource {
  static instances: StubEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  closed = false;

  constructor(public url: string) {
    StubEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }
}

describe("useSnapshot", () => {
  beforeEach(() => {
    StubEventSource.instances = [];
    vi.stubGlobal("EventSource", StubEventSource as unknown as typeof EventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve(fixtureSnapshot),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the initial snapshot on mount", async () => {
    const { result } = renderHook(() => useSnapshot());

    await waitFor(() => expect(result.current.snapshot).not.toBeNull());

    expect(result.current.snapshot?.lastEventId).toBe(fixtureSnapshot.lastEventId);
  });

  it("opens an EventSource against /events and toggles connected on open/error", async () => {
    const { result } = renderHook(() => useSnapshot());

    await waitFor(() => expect(StubEventSource.instances.length).toBe(1));
    const source = StubEventSource.instances[0];
    expect(source.url).toBe("/events");

    act(() => {
      source.onopen?.();
    });
    expect(result.current.connected).toBe(true);

    act(() => {
      source.onerror?.();
    });
    expect(result.current.connected).toBe(false);
  });

  it("replaces the snapshot with whatever the server pushes over the stream", async () => {
    const { result } = renderHook(() => useSnapshot());
    await waitFor(() => expect(StubEventSource.instances.length).toBe(1));
    const source = StubEventSource.instances[0];

    const pushed = { ...fixtureSnapshot, lastEventId: 99 };
    act(() => {
      source.onmessage?.({ data: JSON.stringify(pushed) } as MessageEvent<string>);
    });

    expect(result.current.snapshot?.lastEventId).toBe(99);
  });

  it("closes the EventSource on unmount", async () => {
    const { unmount } = renderHook(() => useSnapshot());
    await waitFor(() => expect(StubEventSource.instances.length).toBe(1));
    const source = StubEventSource.instances[0];

    unmount();

    expect(source.closed).toBe(true);
  });
});
