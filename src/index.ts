import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { ErrorSchema } from "./contracts.js";
import { ComponentPilotError } from "./source.js";
import { ComponentPilotService } from "./service.js";
import { TinyFishFetchReader } from "./tinyfish.js";
import { TinyFishDemoAgent } from "./agent.js";

function response(data: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: data as Record<string, unknown> }; }
function toolError(error: unknown) {
  const known = error instanceof ComponentPilotError;
  const data = ErrorSchema.parse({ error: { code: known ? error.code : "INTERNAL_ERROR", message: known ? error.message : "ComponentPilot encountered an unexpected error.", retryable: known ? error.retryable : false, ...(known && error.details ? { details: error.details } : {}) } });
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }], structuredContent: data, isError: true };
}
const common = { component: z.string().trim().min(2).max(120), source_id: z.string().trim().min(1).max(60).optional() };
// Keep the advertised MCP schema aligned with componentExamples' runtime pagination validation.
const componentExamplesInputSchema = z.object({
  ...common,
  max_results: z.number().int().min(1).max(30).default(12),
  offset: z.number().int().nonnegative().default(0),
});
const inspectComponentDemoInputSchema = z.object({
  component: common.component,
  implementation_name: z.string().trim().min(1).max(120).optional(),
  implementation_url: z.string().url().optional(),
  requested_checks: z.array(z.enum(["tab_click", "accordion_toggle", "combobox_type", "keyboard_navigation"])).min(1).max(4).refine((items) => new Set(items).size === items.length, "requested_checks must not contain duplicates"),
  source_id: common.source_id,
}).refine((input) => Number(Boolean(input.implementation_name)) + Number(Boolean(input.implementation_url)) === 1, { message: "Provide exactly one of implementation_name or implementation_url." });

export function createServer(service = new ComponentPilotService(new TinyFishFetchReader(), new TinyFishDemoAgent())) {
  const server = new McpServer({ name: "componentpilot", version: "0.1.0" });
  server.registerTool("find_components", { description: "Dynamically discover verified component types from a configured public catalogue. Use this first to translate a user's natural-language frontend intent (for example, horizontally browsable products) into returned catalog component name(s); do not guess a component name. Returns source citations.", inputSchema: z.object({ query: z.string().trim().min(2).max(120), max_results: z.number().int().min(1).max(20).default(10), source_id: common.source_id }) }, async ({ query, max_results, source_id }) => { try { return response(await service.findComponents(query, max_results, source_id)); } catch (error) { return toolError(error); } });
  server.registerTool("get_component_examples", { description: "Return one offset-based page of implementations linked by the source component page. Pagination metadata describes the full normalized source-derived result set. Does not invent or crawl external implementation URLs.", inputSchema: componentExamplesInputSchema }, async ({ component, max_results, offset, source_id }) => { try { return response(await service.componentExamples(component, max_results, source_id, offset)); } catch (error) { return toolError(error); } });
  server.registerTool("find_design_systems", { description: "Search design-system names with query and, optionally, filter by a source-published technology tag. Existing query-only technology calls are supported as a documented fallback.", inputSchema: z.object({ query: z.string().trim().max(120).default(""), technology: z.string().trim().min(1).max(80).optional(), max_results: z.number().int().min(1).max(20).default(10), source_id: common.source_id }) }, async ({ query, technology, max_results, source_id }) => { try { return response(await service.designSystems(query, max_results, source_id, technology)); } catch (error) { return toolError(error); } });
  server.registerTool("get_accessibility_guidance", { description: "Return bounded, cited guidance published in an Accessibility section or relevant published markup/keyboard sections. Returns status not_published when none is available.", inputSchema: z.object(common) }, async ({ component, source_id }) => { try { return response(await service.accessibilityGuidance(component, source_id)); } catch (error) { return toolError(error); } });
  server.registerTool("compare_implementations", { description: "Compare distinct implementation references linked by a component page without crawling third-party sites.", inputSchema: z.object({ ...common, implementation_names: z.array(z.string().trim().min(1).max(120)).max(10).default([]), max_results: z.number().int().min(2).max(10).default(5) }) }, async ({ component, implementation_names, max_results, source_id }) => { try { return response(await service.compareImplementations(component, implementation_names, max_results, source_id)); } catch (error) { return toolError(error); } });
  server.registerTool("inspect_component_demo", { description: "Queue a bounded Agent inspection and immediately return its TinyFish run_id; it does not wait for browser execution. The component and source-linked implementation are re-resolved from the live catalogue, and arbitrary URLs, credentials, logins, paywall bypasses, and destructive actions are prohibited. Use get_component_demo_run with the returned run_id for status and the final validated result.", inputSchema: inspectComponentDemoInputSchema }, async ({ component, implementation_name, implementation_url, requested_checks, source_id }) => { try { return response(await service.inspectComponentDemo(component, implementation_name, implementation_url, requested_checks, source_id)); } catch (error) { return toolError(error); } });
  server.registerTool("get_component_demo_run", { description: "Retrieve status or the completed result for an Agent inspection already queued by this ComponentPilot process. This never queues, retries, or bills a second Agent execution. The result-validation context is in memory and unavailable after a server restart.", inputSchema: z.object({ run_id: z.string().trim().min(1).max(200) }) }, async ({ run_id }) => { try { return response(await service.componentDemoRun(run_id)); } catch (error) { return toolError(error); } });
  server.registerTool("health_check", { description: "Verify live source reachability and component-link discovery via TinyFish Fetch.", inputSchema: z.object({ source_id: common.source_id }) }, async ({ source_id }) => { try { return response(await service.healthCheck(source_id)); } catch (error) { return toolError(error); } });
  return server;
}
serveStdio(() => createServer());
