import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/index.js";

type Message = { id?: number; result?: unknown };

async function connectedServer() {
  const calls: Array<{ component: string; maxResults: number; sourceId?: string; offset: number }> = [];
  const service = {
    async componentExamples(component: string, maxResults: number, sourceId: string | undefined, offset: number) {
      calls.push({ component, maxResults, sourceId, offset });
      return { status: "ok", component, examples: [], total: 0, limit: maxResults, offset, has_more: false, next_offset: null, results_complete: true };
    },
    async componentDemoRun(run_id: string) { return { run_id, status: "RUNNING", inspection: null }; },
  };
  const server = createServer(service as never);
  const [client, serverTransport] = InMemoryTransport.createLinkedPair();
  const messages: Message[] = [];
  client.onmessage = (message) => messages.push(message as Message);
  await server.server.connect(serverTransport);
  await client.start();

  async function request(id: number, method: string, params: Record<string, unknown>) {
    await client.send({ jsonrpc: "2.0", id, method, params });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const message = messages.find((candidate) => candidate.id === id);
    expect(message).toBeDefined();
    return message!;
  }

  await request(1, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } });
  await client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  return { calls, client, request };
}

describe("get_component_examples MCP schema", () => {
  it("advertises offset and passes valid offsets to the handler while rejecting negatives", async () => {
    const { calls, client, request } = await connectedServer();
    try {
      const listed = await request(2, "tools/list", {});
      const tool = (listed.result as { tools: Array<{ name: string; inputSchema: { properties: Record<string, Record<string, unknown>> } }> }).tools
        .find(({ name }) => name === "get_component_examples");
      expect(tool?.inputSchema.properties.offset).toMatchObject({ type: "integer", minimum: 0, default: 0 });

      await request(3, "tools/call", { name: "get_component_examples", arguments: { component: "tabs", offset: 0 } });
      await request(4, "tools/call", { name: "get_component_examples", arguments: { component: "tabs", offset: 30 } });
      const invalid = await request(5, "tools/call", { name: "get_component_examples", arguments: { component: "tabs", offset: -1 } });

      expect(calls).toEqual([
        { component: "tabs", maxResults: 12, sourceId: undefined, offset: 0 },
        { component: "tabs", maxResults: 12, sourceId: undefined, offset: 30 },
      ]);
      expect(invalid.result).toMatchObject({
        isError: true,
        content: [{ type: "text", text: expect.stringContaining("offset: Too small") }],
      });
    } finally {
      await client.close();
    }
  });
});

describe("inspect_component_demo MCP schema", () => {
  it("advertises both selectors, explicit auto-selection, and the existing-run lookup contract", async () => {
    const { client, request } = await connectedServer();
    try {
      const listed = await request(6, "tools/list", {});
      const tool = (listed.result as { tools: Array<{ name: string; inputSchema: { properties: Record<string, Record<string, unknown>> } }> }).tools
        .find(({ name }) => name === "inspect_component_demo");
      expect(tool?.inputSchema.properties).toHaveProperty("implementation_name");
      expect(tool?.inputSchema.properties).toHaveProperty("implementation_url");
      expect(tool?.inputSchema.properties.selection_mode).toMatchObject({ type: "string", enum: ["explicit", "auto"], default: "explicit" });
      expect(tool?.inputSchema.properties.component).toMatchObject({ type: "string", minLength: 2 });
      expect(tool?.inputSchema.properties.requested_checks).toMatchObject({ type: "array", minItems: 1, maxItems: 4 });
      expect(tool).toMatchObject({ description: expect.stringContaining("get_component_demo_run") });
    } finally {
      await client.close();
    }
  });
  it("advertises a non-executing queued-run lookup tool", async () => {
    const { client, request } = await connectedServer();
    try {
      const listed = await request(8, "tools/list", {});
      const tool = (listed.result as { tools: Array<{ name: string; inputSchema: { properties: Record<string, Record<string, unknown>> } }> }).tools.find(({ name }) => name === "get_component_demo_run");
      expect(tool?.inputSchema.properties.run_id).toMatchObject({ type: "string", minLength: 1 });
      const result = await request(9, "tools/call", { name: "get_component_demo_run", arguments: { run_id: "run_existing" } });
      expect(result.result).toMatchObject({ structuredContent: { run_id: "run_existing", status: "RUNNING", inspection: null } });
    } finally { await client.close(); }
  });
});

describe("health_check MCP smoke", () => {
  it("advertises bounded probing and returns the structured health result", async () => {
    const { client, request } = await connectedServer();
    try {
      const listed = await request(10, "tools/list", {});
      const tool = (listed.result as { tools: Array<{ name: string; description: string }> }).tools.find(({ name }) => name === "health_check");
      expect(tool?.description).toContain("never queues a paid Agent run");
      // This server has no healthCheck method, so prove the real MCP wiring in a
      // dedicated in-memory server rather than depending on the examples stub.
      const server = createServer({ healthCheck: async () => ({ status: "ok", server: { status: "ok" }, source: { reachability: { status: "reachable" } } }) } as never);
      const [healthClient, transport] = InMemoryTransport.createLinkedPair(); const messages: Message[] = [];
      healthClient.onmessage = (message) => messages.push(message as Message); await server.server.connect(transport); await healthClient.start();
      await healthClient.send({ jsonrpc: "2.0", id: 11, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
      await healthClient.send({ jsonrpc: "2.0", method: "notifications/initialized" });
      await healthClient.send({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "health_check", arguments: {} } });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(messages.find((message) => message.id === 12)?.result).toMatchObject({ structuredContent: { status: "ok", source: { reachability: { status: "reachable" } } } });
      await healthClient.close();
    } finally { await client.close(); }
  });
});
