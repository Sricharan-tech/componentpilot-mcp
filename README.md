# ComponentPilot MCP

ComponentPilot is a local STDIO [MCP](https://modelcontextprotocol.io/) server for finding public UI patterns and source-linked implementations from [The Component Gallery](https://component.gallery/). It retrieves cited evidence live; it does not ship a component database or crawl implementation sites during ordinary research.

## Install and run

Node.js 22+ and a TinyFish API key are required for live use. Copy `.env.example` only for local reference; set the key in your MCP client or shell and never commit it.

```bash
npm install
export TINYFISH_API_KEY='your_tinyfish_api_key'
npm run build
npm test
```

Start the compiled server with `npm start`. MCP messages use standard input/output, so this is not an HTTP server.

## How to use it

Ask in ordinary frontend language. Start with `find_components`, then use the returned catalog component name in follow-up calls. For example: “I need products side by side with previous/next arrows.”

## Tools

Research tools: `find_components`, `get_component_examples`, `find_design_systems`, `get_accessibility_guidance`, `compare_implementations`, and `health_check`. They return bounded, cited source metadata and never follow third-party implementation links.

Agent tools: `inspect_component_demo` validates a source-linked target and queues a TinyFish inspection, returning a `run_id` immediately. `get_component_demo_run` retrieves that same run without queuing, retrying, or billing a second run. Run context is held only in memory, so query it from the same ComponentPilot process.

The Agent accepts a source-linked implementation name, URL, or both when they identify the same source record; it never accepts an arbitrary browsing target. Without a selector it returns a structured list of available names. Set `selection_mode` to `"auto"` only when the user explicitly asks ComponentPilot to select the first source-backed implementation. Its checks are limited, reversible, and return structured errors or uncertainty rather than invented observations. For Tabs, Tab-key focus alone is not treated as arrow-key, activation, tab-panel, or accessibility evidence.

## Evidence and pagination

`get_component_examples` uses offset pagination. Start with `offset: 0`, then keep using `next_offset` while `has_more` is true. `total` is the complete normalized source result count, not the current page length.

Every source-derived record carries `source_url`, `retrieved_at`, and `verification: "source_retrieved"`. Empty results such as `no_match`, `no_results`, and `not_published` are successful responses. Redirects, stale evidence, source-layout changes, blocks, and unsafe links fail explicitly. A citation proves retrieval, not accessibility, quality, safety, or permission to republish linked content.

## Claude Desktop (macOS)

Build first, then add this to Claude Desktop’s MCP configuration. Replace the generic path and key locally; do not put a real key in a repository or chat.

```json
{
  "mcpServers": {
    "componentpilot": {
      "command": "node",
      "args": ["/absolute/path/to/componentpilot-mcp/dist/index.js"],
      "env": { "TINYFISH_API_KEY": "your_tinyfish_api_key" }
    }
  }
}
```

Restart Claude Desktop after editing the configuration or rebuilding.

## Examples

Natural-language discovery prompt:

> I need users to browse several products side by side with previous/next arrows. Find verified Component Gallery patterns first, explain the matches with citations, then show implementation examples for the best match.

First examples page:

```json
{ "component": "Carousel", "max_results": 5, "offset": 0 }
```

Queue an Agent inspection after `get_component_examples` has returned the implementation:

```json
{
  "component": "Carousel",
  "implementation_name": "Example UI",
  "requested_checks": ["keyboard_navigation"]
}
```

Check the same run later; this never starts another inspection:

```json
{ "run_id": "the_run_id_returned_by_inspect_component_demo" }
```

## Test

```bash
npm test
npm run build
```

`npm run health` is an optional live Fetch check and requires `TINYFISH_API_KEY`. Do not bypass an access block; update parser code and tests if the Gallery layout changes.
