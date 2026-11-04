import { TinyFish, type FetchResult } from "@tiny-fish/sdk";
import { BoundedCache, ComponentPilotError, assertFreshTimestamp, assertHttps } from "./source.js";

export type FetchFormat = "markdown" | "html";
export type FetchedPage = { url: string; text: string; links: string[]; title: string | null; description: string | null; retrieved_at: string; format?: FetchFormat };
export interface PageReader { fetch(url: string, format?: FetchFormat): Promise<FetchedPage>; fetchScopedHtml?(url: string, selector: string): Promise<FetchedPage>; }

/** Fetch is the normal low-cost retrieval path. Agent extraction is deliberately not used by tools. */
export class TinyFishFetchReader implements PageReader {
  private readonly client: TinyFish;
  constructor(private readonly cache = new BoundedCache(), client?: TinyFish) { if (!process.env.TINYFISH_API_KEY && !client) throw new ComponentPilotError("MISSING_TINYFISH_API_KEY", "Set TINYFISH_API_KEY before starting ComponentPilot."); this.client = client ?? new TinyFish(); }
  async fetch(url: string, format: FetchFormat = "markdown"): Promise<FetchedPage> {
    assertHttps(url, "source URL"); const cacheKey = `${format}:${url}`; const cached = this.cache.get<FetchedPage>(cacheKey); if (cached) return cached;
    try {
      const response = await this.client.fetch.getContents({ urls: [url], format, links: true, ttl: 0, per_url_timeout_ms: 45_000, purpose: "Retrieve a public component-reference page for a cited, bounded MCP response. Do not bypass access controls." });
      const item = response.results[0] as FetchResult | undefined;
      if (!item || !("text" in item) || typeof item.text !== "string" || !item.text.trim()) throw new ComponentPilotError("TINYFISH_FETCH_FAILED", "TinyFish returned no readable page content.");
      const finalUrl = item.final_url ?? item.url; assertHttps(finalUrl, "resolved source URL");
      const page = { url: finalUrl, text: item.text, links: (item.links ?? []).filter((link): link is string => typeof link === "string"), title: item.title ?? null, description: item.description ?? null, retrieved_at: new Date().toISOString(), format };
      assertFreshTimestamp(page.retrieved_at);
      return this.cache.set(cacheKey, page);
    } catch (error) {
      if (error instanceof ComponentPilotError) throw error;
      const message = error instanceof Error ? error.message : "TinyFish Fetch could not read the source page.";
      if (/\b(?:401|403|forbidden|blocked|access denied|robots)\b/i.test(message)) throw new ComponentPilotError("SOURCE_ACCESS_BLOCKED", "The source denied automated retrieval; ComponentPilot did not attempt to bypass it.");
      throw new ComponentPilotError("TINYFISH_FETCH_FAILED", message, true);
    }
  }

  /**
   * The SDK version used by this project does not expose Fetch's
   * `include_selectors` option. Use the same Fetch endpoint for this one
   * selector-scoped HTML request so card anchors survive extraction.
   */
  async fetchScopedHtml(url: string, selector: string): Promise<FetchedPage> {
    assertHttps(url, "source URL");
    if (!process.env.TINYFISH_API_KEY) throw new ComponentPilotError("MISSING_TINYFISH_API_KEY", "Set TINYFISH_API_KEY before starting ComponentPilot.");
    const cacheKey = `html:${selector}:${url}`; const cached = this.cache.get<FetchedPage>(cacheKey); if (cached) return cached;
    try {
      const response = await fetch("https://api.fetch.tinyfish.ai", { method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": process.env.TINYFISH_API_KEY }, body: JSON.stringify({ urls: [url], format: "html", include_selectors: [selector], links: true, ttl: 0, per_url_timeout_ms: 45_000, purpose: "Retrieve only public component implementation cards for cited, bounded MCP output. Do not bypass access controls." }), signal: AbortSignal.timeout(60_000) });
      const body = await response.json() as { results?: Array<{ url?: string; final_url?: string | null; text?: string | null; links?: unknown[]; title?: string | null; description?: string | null }>; errors?: Array<{ error?: string }> };
      const item = body.results?.[0];
      if (!response.ok || !item || typeof item.text !== "string" || !item.text.trim()) throw new ComponentPilotError("TINYFISH_FETCH_FAILED", body.errors?.[0]?.error || "TinyFish returned no selector-scoped HTML.", response.status >= 500);
      const finalUrl = item.final_url ?? item.url; if (!finalUrl) throw new ComponentPilotError("TINYFISH_FETCH_FAILED", "TinyFish returned no resolved URL for selector-scoped HTML."); assertHttps(finalUrl, "resolved source URL");
      const page = { url: finalUrl, text: item.text, links: (item.links ?? []).filter((link): link is string => typeof link === "string"), title: item.title ?? null, description: item.description ?? null, retrieved_at: new Date().toISOString(), format: "html" as const };
      assertFreshTimestamp(page.retrieved_at);
      return this.cache.set(cacheKey, page);
    } catch (error) {
      if (error instanceof ComponentPilotError) throw error;
      const message = error instanceof Error ? error.message : "TinyFish Fetch could not retrieve selector-scoped HTML.";
      if (/\b(?:401|403|forbidden|blocked|access denied|robots)\b/i.test(message)) throw new ComponentPilotError("SOURCE_ACCESS_BLOCKED", "The source denied automated retrieval; ComponentPilot did not attempt to bypass it.");
      throw new ComponentPilotError("TINYFISH_FETCH_FAILED", message, true);
    }
  }
}
