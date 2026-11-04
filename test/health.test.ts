import { describe, expect, it, vi } from "vitest";
import { ComponentPilotService } from "../src/service.js";
import { BoundedCache } from "../src/source.js";
import { TinyFishFetchReader, type FetchedPage, type PageReader } from "../src/tinyfish.js";

const url = "https://component.gallery/components/";
const catalogue = "# Components\n[Tabs](https://component.gallery/components/tabs/)";
const page = (): FetchedPage => ({ url, text: catalogue, links: ["https://component.gallery/components/tabs/"], title: null, description: null, retrieved_at: new Date().toISOString(), format: "markdown" });

describe("health_check freshness", () => {
  it("expires the process cache at its configured TTL", () => {
    vi.useFakeTimers();
    const cache = new BoundedCache(1_000);
    cache.set("catalogue", "cached");
    expect(cache.get("catalogue")).toBe("cached");
    vi.advanceTimersByTime(1_000);
    expect(cache.get("catalogue")).toBeUndefined();
    vi.useRealTimers();
  });

  it("uses a recent successful probe for repeated health calls, then refreshes when the interval elapses", async () => {
    let calls = 0;
    const reader: PageReader = { fetch: async () => page(), refresh: async () => { calls++; return page(); } };
    let time = new Date("2026-01-01T00:00:00.000Z");
    const service = new ComponentPilotService(reader, undefined, { healthProbeIntervalMs: 300_000, now: () => time });
    await expect(service.healthCheck()).resolves.toMatchObject({ status: "ok", source: { reachability: { status: "reachable" }, cached_data: { status: "fresh" } } });
    await expect(service.healthCheck()).resolves.toMatchObject({ status: "ok", source: { reachability: { status: "recently_reachable" } } });
    expect(calls).toBe(1);
    time = new Date("2026-01-01T00:05:00.000Z");
    await expect(service.healthCheck()).resolves.toMatchObject({ status: "ok", source: { reachability: { status: "reachable" } } });
    expect(calls).toBe(2);
  });

  it("retains the latest successful refresh and reports degraded when a later refresh fails", async () => {
    let succeed = true;
    const reader: PageReader = { fetch: async () => page(), refresh: async () => { if (!succeed) throw new Error("upstream unavailable"); return page(); } };
    let time = new Date("2026-01-01T00:00:00.000Z");
    const service = new ComponentPilotService(reader, undefined, { healthProbeIntervalMs: 1, now: () => time });
    const initial = await service.healthCheck();
    succeed = false; time = new Date("2026-01-01T00:00:01.000Z");
    const degraded = await service.healthCheck();
    expect(degraded).toMatchObject({ status: "degraded", server: { status: "ok" }, source: { reachability: { status: "unreachable" }, latest_successful_refresh_at: initial.checked_at, last_error: { code: "SOURCE_PROBE_FAILED" } } });
  });

  it("shares concurrent forced refreshes in the TinyFish reader", async () => {
    let calls = 0;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const client = { fetch: { getContents: async () => { calls++; await waiting; return { results: [{ url, text: catalogue, links: ["https://component.gallery/components/tabs/"] }] }; } } };
    const reader = new TinyFishFetchReader(new BoundedCache(60_000), client as never);
    const first = reader.refresh(url); const second = reader.refresh(url);
    release();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(calls).toBe(1);
  });

  it("never starts a TinyFish Agent run while checking health", async () => {
    const start = vi.fn();
    const service = new ComponentPilotService({ fetch: async () => page(), refresh: async () => page() }, { start, getRun: vi.fn() } as never);
    await expect(service.healthCheck()).resolves.toMatchObject({ status: "ok" });
    expect(start).not.toHaveBeenCalled();
  });
});
