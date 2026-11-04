import { describe, expect, it } from "vitest";
import { ComponentPilotService, designSystemCards, exampleCards, implementationCardsFromHtml, markdownLinks } from "../src/service.js";
import { findSource } from "../src/source.js";
import { TinyFishFetchReader, type FetchedPage, type PageReader } from "../src/tinyfish.js";

const catalogue = `# Components
[Carousel](https://component.gallery/components/carousel/)
[Button](https://component.gallery/components/button/)
No examples found`;
const carousel = `# Carousel
## Examples
- [Ant Design](https://ant.design/components/carousel) — React
- [Auro](https://auro.alaskaair.com/components/auro/carousel) — Web Components
No examples found
## Accessibility
Always provide on-screen controls for changing carousel slides.
Inactive slides must not be focusable.`;
const systems = `# Design systems
* ## Ant Design

  ### Tech

  + React

  ### Features

  + Open source
* ## Auro

  ### Tech

  + Web Components

  ### Features

  + Open source

No design systems found matching your chosen filters.`;
const tabs = `# Tabs
## Markup
Use role="tab" on each tab and role="tablist" on the tab list.
## Interactivity
Use arrow keys to move between tabs.
## Usage guidelines
Keep labels concise.`;
const button = `# Button
## Description
A clickable control.`;
const cardsHtml = (cards: string) => `<main><h2 id="examples">Examples</h2><ul id="component-examples-list">${cards}</ul></main>`;
const exampleCard = (name: string, links: string[], tech = ["React"], features = ["Open source"]) => `<li><h2>${links.map((href, index) => `<a href="${href}">${index ? "Docs" : "Carousel"}</a>`).join("")}</h2><p>${name}</p><h3>Tech</h3><ul>${tech.map((value) => `<li>${value}</li>`).join("")}</ul><h3>Features</h3><ul>${features.map((value) => `<li>${value}</li>`).join("")}</ul></li>`;
const carouselHtml = cardsHtml(exampleCard("Ant Design", ["https://ant.design/components/carousel"], ["React"], ["Code examples", "Open source"]) + exampleCard("Auro", ["https://auro.alaskaair.com/components/auro/carousel"], ["Web Components"], ["Usage guidelines"]));
const tabsHtml = cardsHtml(exampleCard("Radix UI", ["https://www.radix-ui.com/primitives/docs/components/tabs", "https://www.radix-ui.com/themes/docs/components/tabs#tabs"], ["React"], ["Accessibility", "Open source"]));
const buttonHtml = cardsHtml(exampleCard("GOV.UK", ["https://design-system.service.gov.uk/components/button/"], ["HTML"], ["Accessibility"]));
const manyTabsHtml = cardsHtml(Array.from({ length: 35 }, (_, index) => exampleCard(`Tabs System ${String(index + 1).padStart(2, "0")}`, [`https://example${index + 1}.test/tabs`], ["React"], ["Open source"])).join(""));
class FakeReader implements PageReader {
  async fetch(url: string, format?: "markdown" | "html"): Promise<FetchedPage> {
    const text = format === "html" ? url.includes("carousel") ? carouselHtml : url.includes("tabs") ? tabsHtml : url.includes("button") ? buttonHtml : "<main></main>" : url.includes("design-systems") ? systems : url.includes("carousel") ? carousel : url.includes("tabs") ? tabs : url.includes("button") ? button : catalogue;
    return { url, text, links: url.includes("carousel") ? ["https://ant.design/components/carousel", "https://auro.alaskaair.com/components/auro/carousel"] : ["https://component.gallery/components/carousel/", "https://component.gallery/components/button/", "https://component.gallery/components/tabs/"], title: null, description: null, retrieved_at: new Date().toISOString(), format };
  }
}
class ManyExamplesReader extends FakeReader {
  override async fetch(url: string, format?: "markdown" | "html"): Promise<FetchedPage> {
    if (url.includes("tabs") && format === "html") return { url, text: manyTabsHtml, links: [], title: null, description: null, retrieved_at: new Date().toISOString(), format };
    return super.fetch(url, format);
  }
}
describe("ComponentPilot parser", () => {
  it("preserves each markdown label-to-link association", () => expect(markdownLinks("[Auro](https://auro.alaskaair.com/components/carousel)")[0]).toMatchObject({ label: "Auro", url: "https://auro.alaskaair.com/components/carousel" }));
  it("parses only visible flattened example cards, retaining their metadata", () => {
    const cards = exampleCards("## 2 Examples (2 shown)\n* ## Carousel\n\n  Ant Design\n\n  ### Tech\n\n  + React\n\n  ### Features\n\n  + Open source\n* ## Carousel\n\n  Auro\n\n  ### Tech\n\n  + Web Components\n\n  ### Features\n\n  + Usage guidelines\n\nNo examples found matching your chosen filters.\n\n## Description");
    expect(cards).toEqual([{ name: "Ant Design", technologies: ["React"], tags: ["Open source"] }, { name: "Auro", technologies: ["Web Components"], tags: ["Usage guidelines"] }]);
  });
  it("keeps design-system name matching separate from source-published technology tags", async () => {
    expect(designSystemCards(systems)).toEqual([{ name: "Ant Design", technologies: ["React"], tags: [] }, { name: "Auro", technologies: ["Web Components"], tags: [] }]);
    const service = new ComponentPilotService(new FakeReader());
    await expect(service.designSystems("", 10, undefined, "React")).resolves.toMatchObject({ design_systems: [{ name: "Ant Design", technologies: ["React"] }], matching: { technology: "React", legacy_query_technology_fallback: false } });
    await expect(service.designSystems("React", 10)).resolves.toMatchObject({ design_systems: [{ name: "Ant Design" }], matching: { legacy_query_technology_fallback: true } });
    await expect(service.designSystems("Auro", 10, undefined, "React")).resolves.toMatchObject({ design_systems: [], matching: { legacy_query_technology_fallback: false } });
  });
  it("dynamically finds components and does not treat hidden empty-state text as data", async () => {
    const service = new ComponentPilotService(new FakeReader());
    await expect(service.findComponents("carousel", 10)).resolves.toMatchObject({ components: [{ name: "Carousel", url: "https://component.gallery/components/carousel/" }] });
    await expect(service.componentExamples("carousel", 10)).resolves.toMatchObject({ examples: [{ name: "Ant Design", technologies: ["React"], tags: ["Code examples", "Open source"] }, { name: "Auro", technologies: ["Web Components"] }] });
  });
  it("uses the same card-subtree parser for tabs and compare_implementations, retaining distinct nested links", async () => {
    const service = new ComponentPilotService(new FakeReader());
    await expect(service.componentExamples("tabs", 10)).resolves.toMatchObject({ examples: [{ name: "Radix UI", links: [{ url: "https://www.radix-ui.com/primitives/docs/components/tabs" }, { url: "https://www.radix-ui.com/themes/docs/components/tabs#tabs" }] }] });
    await expect(service.compareImplementations("tabs", ["Radix UI"], 10)).resolves.toMatchObject({ implementations: [{ name: "Radix UI", technologies: ["React"], tags: ["Accessibility", "Open source"] }] });
  });
  it("paginates the full normalized Tabs result set after parsing and deduplication", async () => {
    const service = new ComponentPilotService(new ManyExamplesReader());
    const first = await service.componentExamples("tabs", 30);
    expect(first).toMatchObject({ status: "ok", total: 35, limit: 30, offset: 0, has_more: true, next_offset: 30, results_complete: false });
    expect(first.examples).toHaveLength(30);
    const final = await service.componentExamples("tabs", 30, undefined, 30);
    expect(final).toMatchObject({ status: "ok", total: 35, offset: 30, has_more: false, next_offset: null, results_complete: true });
    expect(final.examples).toHaveLength(5);
    await expect(service.componentExamples("tabs", 10, undefined, 40)).resolves.toMatchObject({ status: "no_results", examples: [], total: 35, offset: 40, has_more: false, next_offset: null, results_complete: true });
  });
  it("uses complete records for comparison filtering, rather than a paginated prefix", async () => {
    const service = new ComponentPilotService(new ManyExamplesReader());
    await expect(service.compareImplementations("tabs", ["Tabs System 35"], 2)).resolves.toMatchObject({ status: "ok", implementations: [{ name: "Tabs System 35" }] });
  });
  it("rejects invalid example page offsets and sizes before fetching", async () => {
    const service = new ComponentPilotService(new FakeReader());
    await expect(service.componentExamples("tabs", 31)).rejects.toMatchObject({ code: "INVALID_PAGINATION" });
    await expect(service.componentExamples("tabs", 10, undefined, -1)).rejects.toMatchObject({ code: "INVALID_PAGINATION" });
    await expect(service.componentExamples("tabs", 10.5)).rejects.toMatchObject({ code: "INVALID_PAGINATION" });
  });
  it("parses another component card from its own subtree", () => {
    expect(implementationCardsFromHtml(buttonHtml, "https://component.gallery/components/button/", "button")).toEqual([expect.objectContaining({ name: "GOV.UK", technologies: ["HTML"], tags: ["Accessibility"], url: "https://design-system.service.gov.uk/components/button/" })]);
  });
  it("fails loudly with actionable counts when cards have missing or unsafe associations", () => {
    const malformed = cardsHtml(exampleCard("Linked", ["https://example.com/linked"]) + exampleCard("", []));
    expect(() => implementationCardsFromHtml(malformed, "https://component.gallery/components/tabs/", "tabs")).toThrow(/could not be associated/);
    try { implementationCardsFromHtml(malformed, "https://component.gallery/components/tabs/", "tabs"); } catch (error) {
      expect(error).toMatchObject({ code: "LINK_ASSOCIATION_UNCERTAIN", details: { component: "tabs", source_url: "https://component.gallery/components/tabs/", cards_found: 2, records_parsed: 1, unresolved_count: 1 } });
    }
  });
  it("returns bounded cited accessibility guidance", async () => {
    const guidance = await new ComponentPilotService(new FakeReader()).accessibilityGuidance("carousel");
    expect(guidance.status).toBe("published"); expect(guidance.guidance).toHaveLength(2); expect(guidance.source.source_url).toContain("carousel");
  });
  it("uses published markup and keyboard guidance when no Accessibility heading exists", async () => {
    const guidance = await new ComponentPilotService(new FakeReader()).accessibilityGuidance("tabs");
    expect(guidance).toMatchObject({ status: "published", sections: ["Markup", "Interactivity"] });
    expect(guidance.guidance).toEqual(expect.arrayContaining([expect.stringContaining('role="tab"'), expect.stringContaining("arrow keys")]));
  });
  it("returns an explicit not-published state instead of a parser error", async () => {
    await expect(new ComponentPilotService(new FakeReader()).accessibilityGuidance("button")).resolves.toMatchObject({ status: "not_published", guidance: [], sections: [] });
  });
  it("does not accept unconfigured source IDs", () => expect(() => findSource("not-configured")).toThrow(/UNKNOWN_SOURCE|Unknown source/));
  it("distinguishes a genuine no-match from a changed catalogue layout", async () => {
    await expect(new ComponentPilotService(new FakeReader()).findComponents("slider", 10)).resolves.toMatchObject({ status: "no_match", components: [] });
    const reader: PageReader = { fetch: async (url) => ({ url, text: "# Welcome\nNothing useful", links: [], title: null, description: null, retrieved_at: new Date().toISOString() }) };
    await expect(new ComponentPilotService(reader).findComponents("tabs", 10)).rejects.toMatchObject({ code: "SOURCE_LAYOUT_CHANGED" });
  });
  it("rejects stale, redirected, and schema-invalid evidence rather than using it", async () => {
    const stale: PageReader = { fetch: async (url) => ({ url, text: catalogue, links: ["https://component.gallery/components/tabs/"], title: null, description: null, retrieved_at: "2000-01-01T00:00:00.000Z" }) };
    await expect(new ComponentPilotService(stale).findComponents("tabs", 1)).rejects.toMatchObject({ code: "STALE_SOURCE" });
    const redirected: PageReader = { fetch: async () => ({ url: "https://evil.example/", text: catalogue, links: [], title: null, description: null, retrieved_at: new Date().toISOString() }) };
    await expect(new ComponentPilotService(redirected).findComponents("tabs", 1)).rejects.toMatchObject({ code: "SOURCE_REDIRECT_UNTRUSTED" });
    await expect(new ComponentPilotService(stale).componentExamples("tabs", 10)).rejects.toMatchObject({ code: "STALE_SOURCE" });
  });
  it("propagates component-example source failures instead of returning a partial page", async () => {
    const broken: PageReader = { fetch: async () => { throw new Error("upstream unavailable"); } };
    await expect(new ComponentPilotService(broken).componentExamples("tabs", 10)).rejects.toThrow("upstream unavailable");
  });
  it("reports a blocked upstream source without attempting to bypass it", async () => {
    const client = { fetch: { getContents: async () => { throw new Error("403 Forbidden"); } } };
    await expect(new TinyFishFetchReader(undefined, client as never).fetch("https://component.gallery/components/")).rejects.toMatchObject({ code: "SOURCE_ACCESS_BLOCKED" });
  });
  it("marks contradictory Tabs source prose as a conflict only when the authority was retrieved", async () => {
    const conflicting = tabs.replace("Use arrow keys to move between tabs.", "← and → to cycle between tabs when aria-orientation=\"vertical\".\n↑ and ↓ to cycle between tabs when aria-orientation=\"horizontal\".");
    const reader: PageReader = { fetch: async (url) => ({ url, text: url.includes("w3.org") ? "horizontal tab list Left Arrow Right Arrow vertical Down Arrow Up Arrow" : url.includes("tabs") ? conflicting : catalogue, links: url.includes("tabs") ? [] : ["https://component.gallery/components/tabs/"], title: null, description: null, retrieved_at: new Date().toISOString() }) };
    await expect(new ComponentPilotService(reader).accessibilityGuidance("tabs")).resolves.toMatchObject({ verification: { status: "conflict", authority: { source_url: "https://www.w3.org/WAI/ARIA/apg/patterns/tabs/" } } });
  });
});
