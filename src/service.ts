import { z } from "zod";
import * as cheerio from "cheerio";
import { CitationSchema, ComponentDemoRunSchema, ComponentDemoStartedSchema, ComponentExamplesResultSchema, ComponentSchema, DesignSystemSchema, ExampleSchema, GuidanceSchema } from "./contracts.js";
import { assertFreshTimestamp, assertHttps, ComponentPilotError, findSource, isSameOriginChild, type SourceConfig } from "./source.js";
import type { FetchedPage, PageReader } from "./tinyfish.js";
import { type DemoAgent, type DemoCheck } from "./agent.js";

type Citation = { source_url: string; retrieved_at: string; verification: "source_retrieved" };
const citation = (page: FetchedPage): Citation => ({ source_url: page.url, retrieved_at: page.retrieved_at, verification: "source_retrieved" });
const clean = (value: string) => value.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
const slugName = (url: string) => decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "").replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Markdown preserves each element's anchor association; never pair flattened text with a separately ordered links array. */
export function markdownLinks(markdown: string): { label: string; url: string; line: number }[] {
  const out: { label: string; url: string; line: number }[] = [];
  for (const [index, line] of markdown.split(/\r?\n/).entries()) for (const match of line.matchAll(/\[([^\]]+)\]\((https:\/\/[^\s)]+)(?:\s+['\"][^)]*['\"])?\)/g)) out.push({ label: clean(match[1]), url: match[2], line: index });
  return out;
}
function section(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/); const start = lines.findIndex((line) => /^#{1,3}\s+/.test(line) && clean(line.replace(/^#+\s+/, "")).toLowerCase() === heading.toLowerCase());
  if (start < 0) return ""; const level = lines[start].match(/^#+/)?.[0].length ?? 2;
  const end = lines.findIndex((line, i) => i > start && (line.match(/^#+/)?.[0].length ?? 99) <= level);
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}
function snippets(markdown: string, max = 12): string[] {
  const result: string[] = [];
  for (const raw of markdown.split(/\r?\n/)) { const text = clean(raw.replace(/^[-*]\s+/, "").replace(/\[[^\]]+\]\([^)]*\)/g, "")); if (text.length >= 24 && !/^#{1,6}\s/.test(raw) && !result.includes(text)) result.push(text.slice(0, 500)); if (result.length === max) break; }
  return result;
}
type ExampleCard = { name: string; technologies: string[]; tags: string[] };
type ImplementationLink = { label: string; url: string };
export type ImplementationRecord = ExampleCard & { url: string; links: ImplementationLink[] };
export const MAX_EXAMPLE_PAGE_SIZE = 30;
/** Parses visible example cards only. The final empty-state sentence is outside every card. */
export function exampleCards(markdown: string): ExampleCard[] {
  const examplesStart = markdown.search(/^##\s+\d+\s+Examples\b/im); const descriptionStart = markdown.search(/^##\s+Description\b/im);
  const block = markdown.slice(examplesStart >= 0 ? examplesStart : 0, descriptionStart >= 0 ? descriptionStart : undefined);
  return block.split(/^\*\s+##\s+/m).slice(1).map((card) => {
    const lines = card.split(/\r?\n/); // The first line is the component type from `* ## Component`; the next text label is the design-system name.
    const name = lines.slice(1).find((line) => { const value = clean(line); return value && !value.startsWith("#") && !value.startsWith("+") && !/^Tech$|^Features$/i.test(value); }) ?? "";
    const take = (heading: string) => { const start = lines.findIndex((line) => clean(line.replace(/^\s*#+\s+/, "")).toLowerCase() === heading); if (start < 0) return []; const values: string[] = []; for (const line of lines.slice(start + 1)) { if (/^\s*###\s+/.test(line)) break; const value = clean(line.replace(/^\s*\+\s+/, "")); if (value && !/^No examples found\b/i.test(value)) values.push(value); } return values; };
    return { name: clean(name), technologies: take("tech"), tags: take("features") };
  }).filter((card) => card.name.length > 0);
}
/** Reads the visible cards in the design-systems index.  Technology values come
 * from each card's own `Tech` block, never from the page-wide filter controls. */
export function designSystemCards(markdown: string): ExampleCard[] {
  const body = markdown.split(/\nNo design systems found matching your chosen filters\./i)[0];
  return body.split(/^\*\s+/m).slice(1).map<ExampleCard | null>((card) => {
    const lines = card.split(/\r?\n/);
    const techAt = lines.findIndex((line) => clean(line.replace(/^\s*#+\s+/, "")).toLowerCase() === "tech");
    if (techAt < 0) return null;
    const nameLine = lines.slice(0, techAt).map((line) => clean(line.replace(/^\s*#{1,6}\s+/, ""))).find((value) => value && !/^(on |github$|figma$|storybook$)/i.test(value));
    const technologies: string[] = [];
    for (const line of lines.slice(techAt + 1)) {
      if (/^\s*###\s+/.test(line)) break;
      const value = clean(line.replace(/^\s*\+\s+/, ""));
      if (value) technologies.push(value);
    }
    return nameLine ? { name: nameLine, technologies, tags: [] as string[] } : null;
  }).filter((card): card is ExampleCard => card !== null);
}
function componentPath(url: string, source: SourceConfig): boolean {
  if (!isSameOriginChild(url, source.catalogue_url)) return false;
  const path = new URL(url).pathname.replace(/\/$/, ""); const root = new URL(source.catalogue_url).pathname.replace(/\/$/, "");
  return path.startsWith(`${root}/`) && path.slice(root.length + 1).split("/").length === 1;
}

/**
 * Reads only the live component examples list.  Every field is derived from one
 * `li` card: its visible system label, its Tech/Features blocks, and its own
 * nested anchors.  Do not replace this with page-wide text/link extraction.
 */
export function implementationCardsFromHtml(html: string, pageUrl: string, component: string): ImplementationRecord[] {
  const $ = cheerio.load(html);
  const cards = $("ul#component-examples-list > li");
  const unresolved: { index: number; reasons: string[] }[] = [];
  const records: ImplementationRecord[] = [];
  cards.each((index, element) => {
    const card = $(element);
    const name = clean(card.children("p").first().text());
    const links: ImplementationLink[] = [];
    const linkUrls = new Set<string>();
    card.find("a[href]").each((_, anchor) => {
      const rawHref = $(anchor).attr("href");
      if (!rawHref) return;
      let url: string;
      try { url = new URL(rawHref, pageUrl).toString(); } catch { return; }
      // Same-page/navigation links are not implementation references.
      // An external implementation URL may legitimately identify its component
      // with a fragment. Only same-origin card navigation is non-evidence.
      if (isSameOriginChild(url, pageUrl)) return;
      try { assertHttps(url, "implementation link"); } catch { return; }
      if (!linkUrls.has(url)) { linkUrls.add(url); links.push({ label: clean($(anchor).text()) || slugName(url), url }); }
    });
    const valuesFor = (heading: string) => {
      const h3 = card.find("h3").filter((_, item) => clean($(item).text()).toLowerCase() === heading.toLowerCase()).first();
      return h3.length ? h3.next("ul").find("li").map((_, item) => clean($(item).text())).get().filter(Boolean) : [];
    };
    const reasons: string[] = [];
    if (!name) reasons.push("missing visible implementation label");
    if (!links.length) reasons.push("missing nested HTTPS implementation link");
    if (reasons.length) { unresolved.push({ index: index + 1, reasons }); return; }
    records.push({ name, url: links[0].url, links, technologies: valuesFor("Tech"), tags: valuesFor("Features") });
  });
  if (!cards.length) throw new ComponentPilotError("SOURCE_LAYOUT_CHANGED", "The component page did not expose the expected examples-card container.", true, { component, source_url: pageUrl, cards_found: 0, unresolved_count: 0 });
  if (unresolved.length) throw new ComponentPilotError("LINK_ASSOCIATION_UNCERTAIN", "One or more example cards could not be associated with nested implementation links without guessing.", true, { component, source_url: pageUrl, cards_found: cards.length, records_parsed: records.length, unresolved_count: unresolved.length, unresolved_cards: unresolved });
  return records;
}

export class ComponentPilotService {
  constructor(private readonly reader: PageReader, private readonly demoAgent?: DemoAgent) {}
  /** Validates every fetched page before any parser can treat it as evidence. */
  private async fetchVerified(expectedUrl: string, source: SourceConfig, format: "markdown" | "html" = "markdown"): Promise<FetchedPage> {
    const page = await this.reader.fetch(expectedUrl, format);
    assertHttps(page.url, "resolved source URL"); assertFreshTimestamp(page.retrieved_at);
    if (!isSameOriginChild(page.url, source.catalogue_url)) throw new ComponentPilotError("SOURCE_REDIRECT_UNTRUSTED", "The source resolved to a different origin and was not used as evidence.");
    if (!page.text.trim()) throw new ComponentPilotError("SOURCE_EMPTY_RESPONSE", "The source returned no readable content.", true);
    return page;
  }
  private async catalogue(sourceId?: string) { const source = findSource(sourceId); return { source, page: await this.fetchVerified(source.catalogue_url, source) }; }
  private assertCatalogueShape(source: SourceConfig, page: FetchedPage): void {
    const count = page.links.filter((url) => componentPath(url, source)).length + markdownLinks(page.text).filter((item) => componentPath(item.url, source)).length;
    if (!count) throw new ComponentPilotError("SOURCE_LAYOUT_CHANGED", "The catalogue was retrieved but no component links matched its configured shape.", true);
  }
  private async tabsVerification(guidance: string[]) {
    const suspicious = guidance.some((item) => /(?:left|right|←|→).*(?:vertical)|(?:up|down|↑|↓).*(?:horizontal)/i.test(item));
    if (!suspicious) return { status: "unverified" as const, detail: "Published by the configured source; no critical Tabs arrow-key claim was detected for cross-checking." };
    try {
      const expected = "https://www.w3.org/WAI/ARIA/apg/patterns/tabs/";
      const page = await this.reader.fetch(expected); assertHttps(page.url, "W3C authority URL"); assertFreshTimestamp(page.retrieved_at);
      if (!isSameOriginChild(page.url, expected) || !/horizontal tab list[\s\S]*Left Arrow[\s\S]*Right Arrow/i.test(page.text) || !/vertical[\s\S]*Down Arrow[\s\S]*Up Arrow/i.test(page.text)) throw new ComponentPilotError("AUTHORITY_SOURCE_CHANGED", "The W3C Tabs Pattern no longer exposes the expected keyboard guidance.", true);
      return { status: "conflict" as const, authority: citation(page), detail: "The source's arrow-key orientation statement conflicts with the retrieved W3C WAI-ARIA APG Tabs Pattern: horizontal uses Left/Right; vertical uses Up/Down. Source text is quoted unchanged." };
    } catch (error) {
      return { status: "unverified" as const, detail: `Published by the configured source; W3C cross-check was unavailable (${error instanceof ComponentPilotError ? error.code : "AUTHORITY_FETCH_FAILED"}).` };
    }
  }
  async findComponents(query: string, maxResults: number, sourceId?: string) {
    const { source, page } = await this.catalogue(sourceId); this.assertCatalogueShape(source, page); const seen = new Set<string>(); const links = markdownLinks(page.text).filter((item) => componentPath(item.url, source));
    for (const url of page.links.filter((item) => componentPath(item, source))) links.push({ label: slugName(url), url, line: -1 });
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const records = links.map((item) => ({ name: item.label || slugName(item.url), url: item.url, summary: null, source: citation(page) })).filter((item) => terms.every((term) => `${item.name} ${item.url}`.toLowerCase().includes(term))).filter((item) => !seen.has(item.url) && (seen.add(item.url), true)).slice(0, maxResults);
    return z.object({ status: z.enum(["ok", "no_match"]), components: z.array(ComponentSchema), source: z.object({ id: z.string(), url: z.string().url(), evidence: CitationSchema }) }).parse({ status: records.length ? "ok" : "no_match", components: records, source: { id: source.id, url: page.url, evidence: citation(page) } });
  }
  private async componentPage(component: string, sourceId?: string) {
    const results = await this.findComponents(component, 20, sourceId); const normalized = component.toLowerCase().replace(/\s+/g, "-"); const match = results.components.find((item) => item.name.toLowerCase() === component.toLowerCase() || new URL(item.url).pathname.endsWith(`/${normalized}`));
    if (!match) throw new ComponentPilotError("COMPONENT_NOT_FOUND", `No component matching ${JSON.stringify(component)} was discovered in the current catalogue.`);
    const duplicate = results.components.filter((item) => item.name.toLowerCase() === match.name.toLowerCase());
    if (duplicate.length > 1) throw new ComponentPilotError("COMPONENT_MATCH_AMBIGUOUS", `More than one source component matched ${JSON.stringify(component)}; refine the component name.`);
    const source = findSource(sourceId); return { component: match, source, page: await this.fetchVerified(match.url, source) };
  }
  private assertExamplePage(maxResults: number, offset: number): void {
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > MAX_EXAMPLE_PAGE_SIZE || !Number.isInteger(offset) || offset < 0) {
      throw new ComponentPilotError("INVALID_PAGINATION", `limit must be an integer from 1 to ${MAX_EXAMPLE_PAGE_SIZE} and offset must be a non-negative integer.`, false, { limit: maxResults, offset });
    }
  }
  /** Retrieves every normalized card before any consumer applies a bound or page. */
  private async implementationRecords(component: string, sourceId?: string) {
    const { source, page } = await this.componentPage(component, sourceId);
    // HTML preserves the example-card subtree that Markdown and the Fetch links
    // array flatten. Selector-scoped parsing makes the link association explicit.
    const htmlPage = this.reader.fetchScopedHtml
      ? await this.fetchScopedHtmlVerified(page.url, source, "#component-examples-list")
      : await this.fetchVerified(page.url, source, "html");
    const examples = implementationCardsFromHtml(htmlPage.text, htmlPage.url, component).map((item) => ({ ...item, source: citation(htmlPage) }));
    // Map insertion order preserves the source card order deterministically.
    return [...new Map(examples.map((item) => [`${item.name}|${item.url}`, item])).values()];
  }
  /** Resolve an Agent target from the current source-linked card set; never accept a user-supplied browsing URL. */
  private async resolveImplementation(component: string, name: string | undefined, url: string | undefined, selectionMode: "explicit" | "auto", sourceId?: string) {
    const records = await this.implementationRecords(component, sourceId);
    const byName = name ? records.find((item) => item.name.toLowerCase() === name.toLowerCase()) : undefined;
    const byUrl = url ? records.find((item) => item.url === url || item.links.some((link) => link.url === url)) : undefined;
    if (name && url && byName !== byUrl) {
      throw new ComponentPilotError("IMPLEMENTATION_MISMATCH", "implementation_name and implementation_url must identify the same source-linked implementation.", false, {
        implementation_name: name,
        implementation_url: url,
        name_match: byName ? { name: byName.name, url: byName.url } : null,
        url_match: byUrl ? { name: byUrl.name, url: byUrl.url } : null,
      });
    }
    if (!name && !url && selectionMode !== "auto") {
      throw new ComponentPilotError("IMPLEMENTATION_SELECTION_REQUIRED", "Choose implementation_name or implementation_url from the source-backed implementations, or explicitly set selection_mode to auto.", false, {
        available_implementation_names: [...new Set(records.map((item) => item.name))],
        selection_mode: "explicit",
      });
    }
    const record = byName ?? byUrl ?? (!name && !url ? records[0] : undefined);
    if (!record) throw new ComponentPilotError("IMPLEMENTATION_NOT_FOUND", "The requested implementation was not linked by the currently retrieved component page.");
    const target = url ?? record.url;
    assertHttps(target, "source-linked implementation URL");
    return { record, target };
  }
  async inspectComponentDemo(component: string, implementationName: string | undefined, implementationUrl: string | undefined, checks: DemoCheck[], sourceId?: string, selectionMode: "explicit" | "auto" = "explicit") {
    if (!this.demoAgent) throw new ComponentPilotError("AGENT_UNAVAILABLE", "The optional TinyFish Agent integration is not configured for this server.");
    const { record, target } = await this.resolveImplementation(component, implementationName, implementationUrl, selectionMode, sourceId);
    const started = await this.demoAgent.start(target, component, checks);
    return ComponentDemoStartedSchema.parse({ status: "queued", run_id: started.run_id, queued_at: started.queued_at, component, implementation: { name: record.name, url: target }, source_url: target, next_tool: "get_component_demo_run" });
  }
  /** Does not queue or retry work: it only retrieves a run previously queued by this server process. */
  async componentDemoRun(runId: string) {
    if (!this.demoAgent?.getRun) throw new ComponentPilotError("AGENT_RUN_LOOKUP_UNAVAILABLE", "The configured Agent integration cannot retrieve queued run status.");
    return ComponentDemoRunSchema.parse(await this.demoAgent.getRun(runId));
  }
  async componentExamples(component: string, maxResults: number, sourceId?: string, offset = 0) {
    this.assertExamplePage(maxResults, offset);
    const examples = await this.implementationRecords(component, sourceId);
    const page = examples.slice(offset, offset + maxResults);
    const hasMore = offset + page.length < examples.length;
    return ComponentExamplesResultSchema.parse({
      status: page.length ? "ok" : "no_results", component, examples: page,
      total: examples.length, limit: maxResults, offset,
      has_more: hasMore, next_offset: hasMore ? offset + page.length : null,
      results_complete: !hasMore,
    });
  }
  private async fetchScopedHtmlVerified(expectedUrl: string, source: SourceConfig, selector: string): Promise<FetchedPage> {
    const page = await this.reader.fetchScopedHtml!(expectedUrl, selector);
    assertHttps(page.url, "resolved source URL"); assertFreshTimestamp(page.retrieved_at);
    if (!isSameOriginChild(page.url, source.catalogue_url)) throw new ComponentPilotError("SOURCE_REDIRECT_UNTRUSTED", "The source resolved to a different origin and was not used as evidence.");
    if (!page.text.trim()) throw new ComponentPilotError("SOURCE_EMPTY_RESPONSE", "The source returned no readable content.", true);
    return page;
  }
  async designSystems(query: string, maxResults: number, sourceId?: string, technology?: string) {
    const source = findSource(sourceId); if (!source.design_systems_url) throw new ComponentPilotError("SOURCE_CAPABILITY_UNAVAILABLE", "This source has no configured design-systems index."); const page = await this.fetchVerified(source.design_systems_url, source);
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean); const requestedTechnology = technology?.trim().toLowerCase();
    const cards = designSystemCards(page.text); if (!cards.length && !/No design systems found/i.test(page.text)) throw new ComponentPilotError("SOURCE_LAYOUT_CHANGED", "The design-systems index no longer exposes recognizable cards.", true);
    const nameMatches = cards.filter((card) => terms.every((term) => card.name.toLowerCase().includes(term)));
    // Older clients passed a technology in `query`. Retain that useful behavior
    // only when no design-system name matched; new clients should use `technology`.
    const legacyTechnology = !requestedTechnology && terms.length > 0 && nameMatches.length === 0 ? query.trim().toLowerCase() : undefined;
    const selected = cards.filter((card) => requestedTechnology
      ? terms.every((term) => card.name.toLowerCase().includes(term)) && card.technologies.some((value) => value.toLowerCase() === requestedTechnology)
      : legacyTechnology ? card.technologies.some((value) => value.toLowerCase() === legacyTechnology)
      : terms.every((term) => card.name.toLowerCase().includes(term)));
    const results = selected.map((card) => ({ name: card.name, url: page.url, summary: null, technologies: card.technologies, source: citation(page) }));
    const unique = [...new Map(results.map((item) => [`${item.name}|${item.technologies.join("|")}`, item])).values()].slice(0, maxResults);
    return z.object({ status: z.enum(["ok", "no_match"]), design_systems: z.array(DesignSystemSchema), matching: z.object({ query: z.string(), technology: z.string().nullable(), legacy_query_technology_fallback: z.boolean() }) }).parse({ status: unique.length ? "ok" : "no_match", design_systems: unique, matching: { query, technology: technology?.trim() || null, legacy_query_technology_fallback: Boolean(legacyTechnology) } });
  }
  async accessibilityGuidance(component: string, sourceId?: string) {
    const { page } = await this.componentPage(component, sourceId);
    const direct = section(page.text, "Accessibility");
    if (direct) {
      const guidance = snippets(direct);
      const verification = component.trim().toLowerCase() === "tabs" ? await this.tabsVerification(guidance) : { status: "unverified" as const, detail: "Published by the configured source; not independently cross-checked." };
      return GuidanceSchema.parse({ component, status: "published", guidance, sections: ["Accessibility"], source: citation(page), verification });
    }
    // Component Gallery's Tabs page publishes its accessibility guidance as
    // semantic markup and keyboard-interaction instructions rather than an
    // Accessibility heading.  Do not infer guidance from unrelated prose.
    const fallbackHeadings = ["Markup", "Interactivity"];
    const published = fallbackHeadings.map((heading) => ({ heading, text: section(page.text, heading) })).filter((item) => item.text.length > 0);
    const guidance = published.flatMap((item) => snippets(item.text, 6)).slice(0, 12);
    const verification = component.trim().toLowerCase() === "tabs" ? await this.tabsVerification(guidance) : { status: "unverified" as const, detail: "Published by the configured source; not independently cross-checked." };
    return GuidanceSchema.parse({ component, status: guidance.length ? "published" : "not_published", guidance, sections: published.map((item) => item.heading), source: citation(page), verification });
  }
  async compareImplementations(component: string, names: string[], maxResults: number, sourceId?: string) {
    const found = await this.implementationRecords(component, sourceId); const wanted = new Set(names.map((name) => name.toLowerCase())); const selected = found.filter((item) => !wanted.size || wanted.has(item.name.toLowerCase())).slice(0, maxResults);
    if (wanted.size && selected.length !== wanted.size) throw new ComponentPilotError("IMPLEMENTATION_NOT_FOUND", "One or more requested implementations were not linked by the currently retrieved component page."); return { status: selected.length ? "ok" : "no_results", component, comparison_basis: "Source-linked implementation names and URLs only; ComponentPilot does not crawl third-party sites for this comparison.", implementations: selected, source: selected[0]?.source ?? null };
  }
  async healthCheck(sourceId?: string) { const { source, page } = await this.catalogue(sourceId); const discovered = page.links.filter((url) => componentPath(url, source)).length || markdownLinks(page.text).filter((item) => componentPath(item.url, source)).length; if (!discovered) throw new ComponentPilotError("SOURCE_LAYOUT_CHANGED", "No component links matched the configured source shape.", true); return { status: "ok", source_id: source.id, source_url: page.url, source: citation(page), components_discovered: discovered, checked_at: new Date().toISOString(), detail: "Catalogue links were dynamically discovered with TinyFish Fetch." }; }
}
