import { TinyFish } from "@tiny-fish/sdk";
import { z } from "zod";
import { ComponentPilotError, assertHttps } from "./source.js";
import { DemoCheckSchema } from "./contracts.js";

export type DemoCheck = z.infer<typeof DemoCheckSchema>;
export type DemoRunStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type AgentInspection = { demo_status: "found" | "not_found" | "inaccessible" | "unsupported"; tested_url: string | null; checks: Array<{ check: DemoCheck; status: "observed" | "not_observed" | "not_tested"; observation: string }>; uncertainty: string[]; run_id: string | null; started_at: string; finished_at: string; steps: number | null; };
export type DemoRunStarted = { run_id: string; status: "PENDING"; queued_at: string };
export type DemoRunLookup = { run_id: string; status: DemoRunStatus; inspection: AgentInspection | null };
export interface DemoAgent { start(url: string, component: string, checks: DemoCheck[]): Promise<DemoRunStarted>; getRun?(runId: string): Promise<DemoRunLookup>; }

const targetedChecks: Record<string, readonly DemoCheck[]> = { tabs: ["tab_click", "keyboard_navigation"], combobox: ["combobox_type", "keyboard_navigation"], accordion: ["accordion_toggle", "keyboard_navigation"] };
export function observationAllowed(component: string, check: DemoCheck): boolean { const allowed = targetedChecks[component.trim().toLowerCase()]; return allowed ? allowed.includes(check) : check === "keyboard_navigation"; }
function inspectionPlan(component: string, checks: DemoCheck[]): string { const known = targetedChecks[component.trim().toLowerCase()]; return known ? `This is a targeted ${component} inspection. Only ${known.join(" or ")} may be observed. For every requested check outside that set, return status not_tested or unsupported; do not substitute another interaction.` : "This is an unknown catalogue pattern. Use limited safe autodiscovery only: identify at most one visible, clearly labelled, reversible control and, only for requested keyboard_navigation, send at most one navigation key. Do not click, type, expand, select, submit, drag, or infer a component-specific interaction."; }
const agentResultSchema = z.object({ demo_status: z.enum(["found", "not_found", "inaccessible", "unsupported"]), tested_url: z.string().url().nullable(), checks: z.array(z.object({ check: DemoCheckSchema, status: z.enum(["observed", "not_observed", "not_tested"]), observation: z.string().min(1).max(1_000) })).max(4), uncertainty: z.array(z.string().min(1).max(500)).max(8).default([]) }).strict();
const outputSchema = { type: "object", properties: { demo_status: { type: "string", enum: ["found", "not_found", "inaccessible", "unsupported"] }, tested_url: { type: "string", nullable: true }, checks: { type: "array", items: { type: "object", properties: { check: { type: "string", enum: ["tab_click", "accordion_toggle", "combobox_type", "keyboard_navigation"] }, status: { type: "string", enum: ["observed", "not_observed", "not_tested"] }, observation: { type: "string" } }, required: ["check", "status", "observation"] } }, uncertainty: { type: "array", items: { type: "string" } } }, required: ["demo_status", "tested_url", "checks", "uncertainty"] };
type UpstreamRun = { run_id: string; status: DemoRunStatus; result: Record<string, unknown> | null; error: { message: string; category?: string; code?: string } | null; num_of_steps: number | null; started_at: string | null; finished_at: string | null };
type TinyFishAgentClient = { agent: { queue(input: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<{ run_id: string | null; error: UpstreamRun["error"] }> }; runs: { get(runId: string): Promise<UpstreamRun> } };
type TrackedRun = { url: string; component: string; checks: DemoCheck[]; queued_at: string; inspection?: AgentInspection };
const terminal = new Set<DemoRunStatus>(["COMPLETED", "FAILED", "CANCELLED"]);
const keyboardEvidence = /\b(?:arrow(?:left|right|up|down)?|left|right|up|down|enter|space)\b|[←→↑↓]/i;

/**
 * The TinyFish queue endpoint acknowledges a run before it executes.  Never
 * wait for execution in an MCP request: Claude can time out while TinyFish
 * subsequently completes.  We retain the request context only to validate a
 * completed result; that local validation context is intentionally lost on a
 * ComponentPilot restart.
 */
export class TinyFishDemoAgent implements DemoAgent {
  private readonly client: TinyFishAgentClient;
  private readonly tracked = new Map<string, TrackedRun>();
  private readonly activeByRequest = new Map<string, string>();
  constructor(client?: TinyFish, private readonly options: { queueTimeoutMs?: number } = {}) { if (!process.env.TINYFISH_API_KEY && !client) throw new ComponentPilotError("MISSING_TINYFISH_API_KEY", "Set TINYFISH_API_KEY before starting ComponentPilot."); this.client = (client ?? new TinyFish()) as unknown as TinyFishAgentClient; }
  private goal(url: string, component: string, checks: DemoCheck[]) { const origin = assertHttps(url, "implementation URL").origin; return [`Inspect the public official ${component} documentation beginning only at ${url}.`, `Do not navigate to a different origin (${origin} is the only permitted origin), log in, use credentials, bypass a paywall or block, submit forms, make purchases, change settings, or perform destructive actions.`, "Find a real interactive component demo. If none exists return not_found; if inaccessible without bypassing controls return inaccessible; if an action is not applicable return unsupported.", inspectionPlan(component, checks), `Only consider these requested checks: ${checks.join(", ")}. Do not claim an action unless its result was observed. For Tabs keyboard_navigation, Tab-key traversal alone is not proof of arrow-key focus movement, activation behavior, tab/panel behavior, or accessibility compliance; report those aspects as unverified unless specifically observed.`, "Return only the requested JSON fields. Every requested check must occur exactly once; use not_tested when no safe observed control supports it. tested_url must be the page actually inspected, or null if no page was inspected."].join(" "); }
  private requestKey(url: string, component: string, checks: DemoCheck[]) { return JSON.stringify([url, component.trim().toLowerCase(), [...checks].sort()]); }
  private async queue(url: string, component: string, checks: DemoCheck[]): Promise<DemoRunStarted> {
    const key = this.requestKey(url, component, checks);
    const existingId = this.activeByRequest.get(key);
    const existing = existingId ? this.tracked.get(existingId) : undefined;
    if (existingId && existing) return { run_id: existingId, status: "PENDING", queued_at: existing.queued_at };
    let queued: { run_id: string | null; error: UpstreamRun["error"] };
    try { queued = await this.client.agent.queue({ url, goal: this.goal(url, component, checks), browser_profile: "lite", capture_config: { snapshots: true, screenshots: false, recording: false, html: false, elements: false }, output_schema: outputSchema }, { signal: AbortSignal.timeout(this.options.queueTimeoutMs ?? 10_000) }); }
    catch (error) { throw new ComponentPilotError("TINYFISH_AGENT_QUEUE_TIMEOUT", "TinyFish did not acknowledge the Agent queue request before the execution deadline; no recoverable run ID is available.", true, { phase: "queue", cause: error instanceof Error ? error.name : "unknown" }); }
    if (!queued.run_id) throw new ComponentPilotError("TINYFISH_AGENT_MISSING_RUN_ID", queued.error?.message ?? "TinyFish accepted no recoverable Agent run ID.", true, { phase: "queue", upstream_code: queued.error?.code, category: queued.error?.category });
    const queuedAt = new Date().toISOString();
    this.tracked.set(queued.run_id, { url, component, checks, queued_at: queuedAt });
    this.activeByRequest.set(key, queued.run_id);
    return { run_id: queued.run_id, status: "PENDING", queued_at: queuedAt };
  }
  private inspectionFrom(run: UpstreamRun, tracked: TrackedRun): AgentInspection {
    if (run.status !== "COMPLETED" || !run.result) { const message = run.error?.message ?? `TinyFish Agent ended with ${run.status}.`; const blocked = /block|captcha|forbidden|denied|paywall/i.test(message); const timedOut = /timeout|timed out|deadline/i.test(message); throw new ComponentPilotError(blocked ? "TINYFISH_AGENT_BLOCKED" : timedOut ? "TINYFISH_AGENT_EXECUTION_TIMEOUT" : "TINYFISH_AGENT_FAILED", message, !blocked, { phase: "execution", run_id: run.run_id, status: run.status, category: run.error?.category, upstream_code: run.error?.code }); }
    const parsed = agentResultSchema.safeParse(run.result);
    if (!parsed.success) throw new ComponentPilotError("AGENT_MALFORMED_OUTPUT", "TinyFish Agent returned an inspection that does not match the required result contract.", true, { run_id: run.run_id, issues: parsed.error.issues.map((issue) => issue.path.join(".")).slice(0, 8) });
    const origin = assertHttps(tracked.url, "implementation URL").origin;
    if (parsed.data.tested_url && assertHttps(parsed.data.tested_url, "Agent tested URL").origin !== origin) throw new ComponentPilotError("AGENT_REDIRECT_UNTRUSTED", "TinyFish Agent reported a tested URL outside the validated implementation origin.", false, { expected_origin: origin, tested_url: parsed.data.tested_url });
    const returned = parsed.data.checks.map((item) => item.check);
    if (returned.length !== tracked.checks.length || new Set(returned).size !== tracked.checks.length || tracked.checks.some((check) => !returned.includes(check))) throw new ComponentPilotError("AGENT_MALFORMED_OUTPUT", "TinyFish Agent did not report exactly the requested interaction checks.", true, { requested_checks: tracked.checks, returned_checks: returned });
    const unsafe = parsed.data.checks.find((item) => item.status === "observed" && !observationAllowed(tracked.component, item.check));
    if (unsafe) throw new ComponentPilotError("AGENT_MALFORMED_OUTPUT", "TinyFish Agent reported an observed interaction outside the bounded inspection policy.", true, { component: tracked.component, check: unsafe.check });
    const genericTabsKeyboard = tracked.component.trim().toLowerCase() === "tabs" && parsed.data.checks.some((item) => item.check === "keyboard_navigation" && item.status === "observed" && !keyboardEvidence.test(item.observation));
    const checks = parsed.data.checks.map((item) => genericTabsKeyboard && item.check === "keyboard_navigation" && item.status === "observed" ? { ...item, status: "not_observed" as const, observation: `${item.observation} Original Agent observation preserved; this alone does not verify tabs arrow-key navigation or activation.` } : item);
    const uncertainty = genericTabsKeyboard ? [...parsed.data.uncertainty, "Tab-key focus traversal was observed, but arrow-key focus movement, activation behavior, tab/panel behavior, and complete accessibility compliance are unverified."].slice(0, 8) : parsed.data.uncertainty;
    return { demo_status: parsed.data.demo_status, tested_url: parsed.data.tested_url, checks, uncertainty, run_id: run.run_id, started_at: run.started_at ?? tracked.queued_at, finished_at: run.finished_at ?? new Date().toISOString(), steps: run.num_of_steps };
  }
  async getRun(runId: string): Promise<DemoRunLookup> {
    const tracked = this.tracked.get(runId); if (!tracked) throw new ComponentPilotError("AGENT_RUN_NOT_TRACKED", "This server process has no record of that Agent run ID. Run tracking is in memory only; use the same running ComponentPilot process that queued it.", false, { run_id: runId });
    if (tracked.inspection) return { run_id: runId, status: "COMPLETED", inspection: tracked.inspection };
    let run: UpstreamRun; try { run = await this.client.runs.get(runId); } catch (error) { throw new ComponentPilotError("TINYFISH_AGENT_POLL_FAILED", "TinyFish could not retrieve the queued Agent run.", true, { phase: "poll", run_id: runId, cause: error instanceof Error ? error.name : "unknown" }); }
    if (!terminal.has(run.status)) return { run_id: runId, status: run.status, inspection: null };
    const inspection = this.inspectionFrom(run, tracked); tracked.inspection = inspection; return { run_id: runId, status: run.status, inspection };
  }
  async start(url: string, component: string, checks: DemoCheck[]): Promise<DemoRunStarted> { return this.queue(url, component, checks); }
}
