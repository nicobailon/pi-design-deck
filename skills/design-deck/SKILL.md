---
name: design-deck
description: Show side-by-side visual options (UI mockups, architecture diagrams, code patterns, images) in a deck and collect the user's picks with design_deck. Use for decisions that are easier to see than read, including plan/PRD reviews and generate-more requests from an open deck. Text-only choices go to interview.
---

# Design Deck

`design_deck` is a native tool: call it directly, not through `mcp`.

## When

- **Deck vs interview**: use a deck when options differ in how they look. If they differ only in words, ask with `interview` single-choice questions; no window opens.
- **Build or ask first**: build directly when a plan/PRD, a concrete request ("3 ways to redesign the sidebar"), or settled constraints give you enough to draw real options. Interview first only when goals, audience, aesthetic or technical limits are missing.
- **From a plan/PRD**: read it in full plus the code it references. One slide per decision point that has more than one viable approach; cite the plan section in `aside`.

## Building the deck

- One decision per slide, 2–5 slides, foundational before aesthetic (architecture → API → UI).
- 2–4 options per slide. `description` is a one-line rationale (hover), `aside` is 2–4 short tradeoff lines under the preview (`\n` breaks), `recommended: true` when you have an opinion, slide `context` frames the decision.
- Omit `columns`; layout follows option count. `columns: 1` only for wide diagrams or long code, `4` for many small items (swatches, icons).
- `slides` takes this object serialized to a JSON **string**, or a path to a `.json` file holding it (relative to cwd or `~`). For a large deck, write the file and pass its path.

```json
{ "title": "Backend", "slides": [{ "id": "arch", "title": "Architecture", "context": "Pick the backend shape.", "options": [
  { "label": "Monolith", "aside": "Simple to deploy.\nWatch coupling.",
    "previewBlocks": [{ "type": "mermaid", "content": "graph TD\n  Client-->API-->DB" }] },
  { "label": "Event-driven", "recommended": true,
    "previewBlocks": [{ "type": "code", "code": "bus.publish('order.created', order)", "lang": "ts" }] }
]}]}
```


### Previews

Each option has exactly one of:

- **`previewBlocks`** for technical comparisons: blocks stack in order and mix freely (`html`, `mermaid` with an optional `theme` object of Mermaid themeVariables like `{"primaryColor":"#0d1117"}`, `code`, `image` with an absolute `src`). Each block should add what the others don't: diagram shows what, code shows how.
- **`previewHtml`** for UI mockups: set via `innerHTML` into the card, so `<link>` fonts load but `<script>` never runs. Inline styles with your own colors and fonts, no Tailwind. Cards split the window width and are narrow at 3 columns, so keep layouts fluid. The deck chrome is dark.

Images: if `surf` is installed, `surf gemini "<prompt>" --generate-image /tmp/x.png --aspect-ratio 16:9`. Use them for mood, style and visuals mermaid can't draw; keep flows and data models in mermaid so they stay editable.

## Distinct options

**Alternatives, not variants.** A stakeholder with strong opinions could pick one and reject the others for real reasons, and each pick leads to a different implementation.

- **Architecture**: different structures (monolith / services / serverless, sync / event-sourced) and different priorities (simplicity / scale / flexibility). Match the diagram to the story: flowchart, sequence, ER.
- **Code**: different paradigms (composition / inheritance, push / pull, mutable / immutable). Show the call site, types and error handling where the approaches diverge.
- **UI**: each option looks like a different designer made it, varying layout, type scale and spacing, not just palette. Commit to a direction (stark minimal, editorial serif, terminal, neo-brutalist, dark luxury). Headlines 3–4× body size with strong weight contrast. Skip AI defaults: indigo/violet primaries, blue-purple gradients, Inter or system-ui alone, centered identical cards. Options should suit different brands.

## While the deck is open

- **Generate more / regenerate**: the tool's reply names the slide, the count, the exact `add-options` or `replace-options` call, and a `deck_generate` call when the user picked a model. Make that one call, distinct from the options already shown; the user's prompt in the reply is the main direction.
- **Submit**: the reply lists `slideId: chosen label` plus notes. Build to it.
- **Saved decks**: `action: "list"`, `"open"` with `deckId`, `"export"` to HTML.

## Look up the rest

- Options for a UI component (tabs, tree view, accordion…) → [components.md](references/component-gallery/components.md); grep `## <Component>` and read that section only
- Ambiguous term ("dropdown", "popup") or the user describes intent → [LOOKUP.md](references/component-gallery/LOOKUP.md)
- Design-system vocabularies (Blueprint, Ant, 98.css…) and distinct systems vs variations → [INDEX.md](references/component-gallery/INDEX.md)
- Real implementations of one component → `references/component-gallery/components/<category>.md` (over the read limit: grep the heading), or `https://component.gallery/components/<name>/`
