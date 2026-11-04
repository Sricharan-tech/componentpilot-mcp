import { describe, expect, it } from "vitest";
import { TinyFishDemoAgent, type DemoAgent } from "../src/agent.js";
import { ComponentPilotService } from "../src/service.js";
import type { FetchedPage, PageReader } from "../src/tinyfish.js";

const now = () => new Date().toISOString();
const catalogue = "# Components\n[Tabs](https://component.gallery/components/tabs/)";
const cards = `<ul id="component-examples-list"><li><p>Radix UI</p><a href="https://www.radix-ui.com/primitives/docs/components/tabs">Docs</a><h3>Tech</h3><ul><li>React</li></ul><h3>Features</h3><ul><li>Open source</li></ul></li></ul>`;
class Reader implements PageReader {
  async fetch(url: string, format?: "markdown" | "html"): Promise<FetchedPage> {
    return { url, text: format === "html" ? cards : url.includes("/tabs/") ? "# Tabs" : catalogue, links: url.includes("/tabs/") ? [] : ["https://component.gallery/components/tabs/"], title: null, description: null, retrieved_at: now(), format };
  }
}
const found = { demo_status: "found" as const, tested_url: "https://www.radix-ui.com/primitives/docs/components/tabs", checks: [{ check: "tab_click" as const, status: "observed" as const, observation: "Clicked the second visible tab and its panel became visible." }, { check: "keyboard_navigation" as const, status: "observed" as const, observation: "Right Arrow moved focus to the next visible tab." }], uncertainty: ["Observed only the displayed demo state."], run_id: "run_fixture", started_at: "2026-11-04T00:00:00.000Z", finished_at: "2026-11-04T00:00:01.000Z", steps: 4 };
const queued = { run_id: "run_fixture", status: "PENDING" as const, queued_at: "2026-11-04T00:00:00.000Z" };

describe("optional demo inspection", () => {
  it("accepts an implementation name and returns a queued run ID without waiting for execution", async () => {
    const agent: DemoAgent = { start: async () => queued };
    const result = await new ComponentPilotService(new Reader(), agent).inspectComponentDemo("Tabs", "Radix UI", undefined, ["tab_click", "keyboard_navigation"]);
    expect(result).toMatchObject({ status: "queued", run_id: "run_fixture", source_url: "https://www.radix-ui.com/primitives/docs/components/tabs", next_tool: "get_component_demo_run" });
  });
  it("accepts a source-linked implementation URL", async () => {
    const agent: DemoAgent = { start: async () => queued };
    await expect(new ComponentPilotService(new Reader(), agent).inspectComponentDemo("Tabs", undefined, "https://www.radix-ui.com/primitives/docs/components/tabs", ["tab_click"])).resolves.toMatchObject({ implementation: { name: "Radix UI" } });
  });
  it("accepts matching implementation name and URL", async () => {
    const agent: DemoAgent = { start: async () => queued };
    await expect(new ComponentPilotService(new Reader(), agent).inspectComponentDemo("Tabs", "Radix UI", "https://www.radix-ui.com/primitives/docs/components/tabs", ["tab_click"])).resolves.toMatchObject({ implementation: { name: "Radix UI" } });
  });
  it("rejects conflicting implementation name and URL without starting an Agent run", async () => {
    const twoCards = `<ul id="component-examples-list"><li><p>Radix UI</p><a href="https://www.radix-ui.com/primitives/docs/components/tabs">Docs</a></li><li><p>Reach UI</p><a href="https://reach.tech/tabs">Docs</a></li></ul>`;
    const reader: PageReader = { async fetch(url, format) { return { url, text: format === "html" ? twoCards : url.includes("/tabs/") ? "# Tabs" : catalogue, links: url.includes("/tabs/") ? [] : ["https://component.gallery/components/tabs/"], title: null, description: null, retrieved_at: now(), format }; } };
    let starts = 0;
    const agent: DemoAgent = { start: async () => { starts++; return queued; } };
    await expect(new ComponentPilotService(reader, agent).inspectComponentDemo("Tabs", "Radix UI", "https://reach.tech/tabs", ["tab_click"])).rejects.toMatchObject({ code: "IMPLEMENTATION_MISMATCH", details: { name_match: { name: "Radix UI" }, url_match: { name: "Reach UI" } } });
    expect(starts).toBe(0);
  });
  it("lists source-backed implementation names when no selector was provided", async () => {
    const agent: DemoAgent = { start: async () => { throw new Error("must not run"); } };
    await expect(new ComponentPilotService(new Reader(), agent).inspectComponentDemo("Tabs", undefined, undefined, ["tab_click"])).rejects.toMatchObject({ code: "IMPLEMENTATION_SELECTION_REQUIRED", details: { available_implementation_names: ["Radix UI"] } });
  });
  it("auto-selects only when selection_mode is explicitly requested", async () => {
    const agent: DemoAgent = { start: async () => queued };
    await expect(new ComponentPilotService(new Reader(), agent).inspectComponentDemo("Tabs", undefined, undefined, ["tab_click"], undefined, "auto")).resolves.toMatchObject({ implementation: { name: "Radix UI" } });
  });
  it("retrieves an existing run without queuing another paid Agent run", async () => {
    let starts = 0; let polls = 0;
    const agent: DemoAgent = {
      start: async () => { starts++; return queued; },
      getRun: async (run_id) => { polls++; return { run_id, status: "RUNNING", inspection: null }; },
    };
    const service = new ComponentPilotService(new Reader(), agent);
    const started = await service.inspectComponentDemo("Tabs", "Radix UI", undefined, ["tab_click"]);
    await expect(service.componentDemoRun(started.run_id)).resolves.toMatchObject({ status: "RUNNING", inspection: null });
    expect({ starts, polls }).toEqual({ starts: 1, polls: 1 });
  });
  it("refuses an arbitrary implementation URL before an Agent can browse it", async () => {
    const agent: DemoAgent = { start: async () => { throw new Error("must not run"); } };
    await expect(new ComponentPilotService(new Reader(), agent).inspectComponentDemo("Tabs", undefined, "https://evil.example/tabs", ["tab_click"])).rejects.toMatchObject({ code: "IMPLEMENTATION_NOT_FOUND" });
  });
  it("dynamically resolves a catalogue pattern outside the original three", async () => {
    const carouselCatalogue = "# Components\n[Carousel](https://component.gallery/components/carousel/)";
    const carouselCards = `<ul id="component-examples-list"><li><p>Example UI</p><a href="https://docs.example.com/carousel">Docs</a><h3>Tech</h3><ul><li>Web</li></ul><h3>Features</h3><ul><li>Example</li></ul></li></ul>`;
    const reader: PageReader = { async fetch(url, format) { return { url, text: format === "html" ? carouselCards : url.includes("/carousel/") ? "# Carousel" : carouselCatalogue, links: url.includes("/carousel/") ? [] : ["https://component.gallery/components/carousel/"], title: null, description: null, retrieved_at: now(), format }; } };
    const agent: DemoAgent = { start: async () => queued };
    await expect(new ComponentPilotService(reader, agent).inspectComponentDemo("Carousel", "Example UI", undefined, ["keyboard_navigation"])).resolves.toMatchObject({ component: "Carousel", status: "queued" });
  });
  it("does not invoke the Agent for a component absent from the live catalogue", async () => {
    const agent: DemoAgent = { start: async () => { throw new Error("must not run"); } };
    await expect(new ComponentPilotService(new Reader(), agent).inspectComponentDemo("Carousel", "Radix UI", undefined, ["keyboard_navigation"])).rejects.toMatchObject({ code: "COMPONENT_NOT_FOUND" });
  });
});

describe("TinyFish Agent adapter", () => {
  const complete = (run_id: string, result: unknown) => ({ run_id, status: "COMPLETED", result, error: null, num_of_steps: 3, started_at: now(), finished_at: now() });
  const clientFor = (runs: unknown[]) => { let index = 0; return { agent: { queue: async () => ({ run_id: "run_1", error: null }) }, runs: { get: async () => runs[Math.min(index++, runs.length - 1)] } }; };
  it("returns immediately after queue acknowledgement and retrieves delayed completion without a duplicate execution", async () => {
    let queueCalls = 0; let getCalls = 0; let request: Record<string, unknown> | undefined;
    const client = { agent: { queue: async (input: Record<string, unknown>) => { queueCalls++; request = input; return { run_id: "run_1", error: null }; } }, runs: { get: async () => { getCalls++; return complete("run_1", { demo_status: "found", tested_url: "https://docs.example.com/tabs/demo", checks: found.checks, uncertainty: [] }); } } };
    const agent = new TinyFishDemoAgent(client as never);
    await expect(agent.start("https://docs.example.com/tabs", "Tabs", ["tab_click", "keyboard_navigation"])).resolves.toMatchObject({ status: "PENDING", run_id: "run_1" });
    expect(queueCalls).toBe(1); expect(getCalls).toBe(0); expect(request).toMatchObject({ browser_profile: "lite", capture_config: { snapshots: true, screenshots: false } });
    await expect(agent.getRun("run_1")).resolves.toMatchObject({ status: "COMPLETED", inspection: { run_id: "run_1" } });
    expect(queueCalls).toBe(1); expect(getCalls).toBe(1);
  });
  it("reuses an identical in-process queued run instead of billing a retry", async () => {
    let queueCalls = 0;
    const client = { agent: { queue: async () => { queueCalls++; return { run_id: "run_deduped", error: null }; } }, runs: { get: async () => { throw new Error("not needed"); } } };
    const agent = new TinyFishDemoAgent(client as never);
    const first = await agent.start("https://docs.example.com/tabs", "Tabs", ["tab_click", "keyboard_navigation"]);
    const retry = await agent.start("https://docs.example.com/tabs", "tabs", ["keyboard_navigation", "tab_click"]);
    expect(retry.run_id).toBe(first.run_id);
    expect(queueCalls).toBe(1);
  });
  it("does not poll during start, and later returns the result from the same run", async () => {
    let completeNow = false; let queueCalls = 0;
    const client = { agent: { queue: async () => { queueCalls++; return { run_id: "run_late", error: null }; } }, runs: { get: async () => completeNow ? complete("run_late", { demo_status: "found", tested_url: "https://docs.example.com/tabs", checks: [{ check: "tab_click", status: "observed", observation: "clicked" }], uncertainty: [] }) : { run_id: "run_late", status: "RUNNING", result: null, error: null, num_of_steps: null, started_at: now(), finished_at: null } } };
    const agent = new TinyFishDemoAgent(client as never);
    await expect(agent.start("https://docs.example.com/tabs", "Tabs", ["tab_click"])).resolves.toMatchObject({ run_id: "run_late" });
    await expect(agent.getRun("run_late")).resolves.toMatchObject({ status: "RUNNING", inspection: null });
    completeNow = true;
    await expect(agent.getRun("run_late")).resolves.toMatchObject({ status: "COMPLETED", inspection: { demo_status: "found" } }); expect(queueCalls).toBe(1);
  });
  it("does not upgrade generic Tab traversal into Tabs keyboard compliance", async () => {
    const agent = new TinyFishDemoAgent(clientFor([complete("run_1", { demo_status: "found", tested_url: "https://docs.example.com/tabs", checks: [{ check: "keyboard_navigation", status: "observed", observation: "Tab key successfully navigated focus through the page." }], uncertainty: [] })]) as never);
    await agent.start("https://docs.example.com/tabs", "Tabs", ["keyboard_navigation"]);
    await expect(agent.getRun("run_1")).resolves.toMatchObject({ inspection: { checks: [{ status: "not_observed", observation: expect.stringContaining("Original Agent observation preserved") }], uncertainty: [expect.stringContaining("arrow-key")] } });
  });
  it("reports malformed output, execution failures, and missing IDs structurally", async () => {
    const malformed = new TinyFishDemoAgent(clientFor([complete("run_1", { demo_status: "found", tested_url: "https://docs.example.com/tabs", checks: [], uncertainty: [] })]) as never);
    await malformed.start("https://docs.example.com/tabs", "Tabs", ["tab_click"]);
    await expect(malformed.getRun("run_1")).rejects.toMatchObject({ code: "AGENT_MALFORMED_OUTPUT" });
    const failed = new TinyFishDemoAgent(clientFor([{ run_id: "run_1", status: "FAILED", result: null, error: { message: "execution timed out", category: "SYSTEM_FAILURE" }, num_of_steps: null, started_at: now(), finished_at: now() }]) as never);
    await failed.start("https://docs.example.com/tabs", "Tabs", ["tab_click"]);
    await expect(failed.getRun("run_1")).rejects.toMatchObject({ code: "TINYFISH_AGENT_EXECUTION_TIMEOUT", details: { phase: "execution" } });
    const missing = new TinyFishDemoAgent({ agent: { queue: async () => ({ run_id: null, error: null }) }, runs: { get: async () => { throw new Error("unreachable"); } } } as never);
    await expect(missing.start("https://docs.example.com/tabs", "Tabs", ["tab_click"])).rejects.toMatchObject({ code: "TINYFISH_AGENT_MISSING_RUN_ID" });
    await expect(missing.getRun("missing_run")).rejects.toMatchObject({ code: "AGENT_RUN_NOT_TRACKED", details: { run_id: "missing_run" } });
  });
  it("reports a queue deadline separately from an execution failure", async () => {
    const client = { agent: { queue: async () => { throw new DOMException("aborted", "AbortError"); } }, runs: { get: async () => { throw new Error("unreachable"); } } };
    const agent = new TinyFishDemoAgent(client as never, { queueTimeoutMs: 1 });
    await expect(agent.start("https://docs.example.com/tabs", "Tabs", ["tab_click"])).rejects.toMatchObject({ code: "TINYFISH_AGENT_QUEUE_TIMEOUT", details: { phase: "queue", cause: "AbortError" } });
  });
});
