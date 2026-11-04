# ComponentPilot MCP — Example Prompts

ComponentPilot helps AI assistants research UI components using [The Component Gallery](https://component.gallery), compare implementations, explore design systems, investigate accessibility guidance, and test live demos using TinyFish.

Once ComponentPilot is connected to your MCP-compatible assistant, try the following prompts.

**Note:** The responses below are examples of expected behavior, not guaranteed output. Results depend on the live source, available implementations, and whether an interactive test completes successfully.

---

## 1. Discover a component from a plain-English description

**Prompt**

> I'm building a dashboard and want users to switch between Profile, Settings, and Activity without navigating to different pages. What's the right component for this?

**Expected result**

- Identifies **Tabs** as the relevant UI component.
- Explains how tabs work.
- Links to the component's catalogue page.
- Suggests looking at implementations if needed.

**ComponentPilot capability:** Natural-language component discovery.

---

## 2. Find React implementations

**Prompt**

> I'm building a React application and need an accessible tabs component. Can you find a few libraries that provide one and share their documentation?

**Expected result**

Finds relevant implementations such as:

| Library | Documentation |
|---|---|
| Ariakit | https://ariakit.org/components/tab |
| Headless UI | https://headlessui.com/react/tabs |
| Chakra UI | https://chakra-ui.com/docs/components/tabs |
| Ant Design | https://ant.design/components/tabs |

The assistant should distinguish source-provided accessibility tags from independent accessibility verification.

**ComponentPilot capability:** Implementation discovery and source attribution.

---

## 3. Compare implementations

**Prompt**

> I'm deciding between Ariakit, Headless UI, and Chakra UI for tabs in a React dashboard. Can you compare them and help me choose?

**Expected result**

A comparison covering available catalogue metadata, implementation links, and differences in styling or customization where supported by evidence.

The assistant should explain which information comes from ComponentPilot and which is its own general knowledge.

**ComponentPilot capability:** Implementation comparison.

---

## 4. Explore design systems

**Prompt**

> I'm starting a new dashboard and would rather use an established design system than build every component myself. Which design systems have tabs, and where can I see their implementations?

**Expected result**

Finds relevant design systems and links to their Tabs implementations, where available.

Examples may include Atlassian Design System, IBM Carbon, Microsoft Fluent UI, Chakra UI, and Ant Design.

**ComponentPilot capability:** Design-system discovery.

---

## 5. Research accessibility

**Prompt**

> I'm adding tabs to my website, but I want keyboard users to be able to navigate them properly. What accessibility behavior should I look for, and which implementations have useful accessibility guidance?

**Expected result**

- Retrieves available accessibility guidance.
- Identifies implementations with relevant catalogue tags.
- Explains expected keyboard interactions.
- Highlights any discrepancies between source guidance and established standards.

For horizontal tabs, the W3C ARIA Authoring Practices recommend Left/Right arrow navigation.

**Important:** Documentation and accessibility tags are not proof that a live implementation passes accessibility testing.

**ComponentPilot capability:** Accessibility research.

---

## 6. Test a real component interactively

**Prompt**

> I'm considering Ariakit Tabs for my React project. Could you use ComponentPilot to open the live example and actually try switching between tabs? I want to know whether the content changes correctly, not just what the documentation claims. Please tell me exactly what you observed.

**Expected result**

ComponentPilot starts an interactive test using TinyFish Agent.

A completed test may report:

- The implementation and demo URL visited.
- Which tabs were clicked.
- Whether the displayed content changed.
- Any actions that were skipped or couldn't be verified.

**Example from an actual ComponentPilot test:**

On Ariakit's Tabs demo, TinyFish Agent clicked Fruits, Vegetables, and Meat. The displayed content changed to the corresponding items for each tab.

Keyboard arrow navigation was **not verified** in that run.

**ComponentPilot capabilities:** Live demo inspection and observed interaction reporting.

---

## 7. Run an end-to-end component research workflow

**Prompt**

> Hey, I'm building a React dashboard and I'm struggling with the account section.
>
> I want people to switch between their Profile, Settings, and Activity without leaving the page. I'm not sure which component or library is best.
>
> Could you use ComponentPilot to research a few options, compare their implementations, see which design systems support them, and check their accessibility guidance?
>
> Before recommending one, I'd also like you to actually try a live demo through ComponentPilot. Click between the sections and tell me whether the content changes. If possible, check keyboard navigation too.
>
> Please make sure ComponentPilot is working properly, and give me your recommendation with links. Use ComponentPilot for the live test rather than your own browser.

**Expected result**

The assistant should:

1. Verify ComponentPilot's server and source status.
2. Identify Tabs as a likely component.
3. Retrieve relevant implementations.
4. Explore available design systems.
5. Review accessibility guidance.
6. Compare suitable libraries.
7. Start a TinyFish Agent live interaction test.
8. Retrieve the result of that same test and report verified observations.

If the interactive test is still running, the assistant should report its status rather than inventing a successful result.

**ComponentPilot capabilities:** Complete MCP research and interactive testing workflow.

---

## 8. Check server and source health

**Prompt**

> Before we start, can you check whether ComponentPilot is working and whether its component catalogue data is up to date?

**Expected result**

A structured health report describing:

- MCP server health.
- Reachability of the source website.
- Source or cache freshness.
- Relevant component catalogue information.

A stale cache should be distinguished from an unreachable source.

**ComponentPilot capability:** Health monitoring.

---

## 9. Explore a larger collection

**Prompt**

> I want to explore all the Tabs implementations available in ComponentPilot, not just the first few results. Can you go through the full list and help me narrow it down to React options?

**Expected result**

The assistant retrieves additional result pages as needed rather than treating the initial page as the complete catalogue.

The total number of implementations may change as The Component Gallery is updated.

**ComponentPilot capability:** Paginated catalogue exploration.

---

## 10. Handle unsupported or uncertain requests

**Prompt**

> I'm designing a 3D interactive star map. Does ComponentPilot have a matching component pattern, or something close to it?

**Expected result**

The assistant searches the catalogue and reports whether a suitable component exists.

It should not invent catalogue entries or claim that an unsupported component was found.

**ComponentPilot capability:** Source-grounded search and transparent limitations.

---

## Tips for reliable results

- Describe the interface you're trying to build. You don't need to know the technical component name.
- Ask for source links when comparing implementations.
- If you want real interaction evidence, explicitly ask ComponentPilot to test a live demo.
- An interactive test may take longer than a normal catalogue search.
- Ask the assistant to distinguish observed behavior from documentation claims.
- If a live test is incomplete, an honest partial result is better than an unsupported pass.
- Use ComponentPilot's existing run-status functionality to check an ongoing test rather than starting duplicate paid runs.

## Source

Component catalogue: https://component.gallery

ComponentPilot repository: https://github.com/Sricharan-tech/componentpilot-mcp
