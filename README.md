<p>
  <img src="banner.png" alt="pi-design-deck" width="1100">
</p>

# Design Deck

A tool for [Pi coding agent](https://github.com/badlogic/pi-mono/) that presents multi-slide visual decision decks in the browser. Each slide shows 2-4 high-fidelity previews — code diffs, architecture diagrams, UI mockups — and you pick one per slide. The agent gets back a clean selection map and moves on to implementation.

<img width="1340" alt="Design Deck screenshot" src="https://github.com/user-attachments/assets/20864ac6-9223-4e2e-ba3c-db3eaae0abd8" />

## Usage

Just ask. The agent reaches for the design deck when visual comparison makes sense.

```
show me 3 architecture options for the backend
present a few UI directions for the settings page
what are my options for the auth flow? show me visually
read the PRD at docs/api-plan.md and present the key decisions
```

Three slash commands are also available for more structured flows:

- **`/deck`** — general purpose. Give it a topic or run it bare.
- **`/deck-plan docs/plan.md`** — reads a plan or PRD, identifies decision points, builds slides for each.
- **`/deck-discover`** — interviews you first to gather requirements, then builds a deck from what it learned.

## Why

The interview tool gathers structured input — you answer questions. The design deck is the other direction: the agent shows you visual options and you pick. They work together — interview discovers requirements, deck presents the resulting options — but they're distinct tools for distinct jobs.

The persistent server architecture means the browser stays open across tool re-invocations. When you click "Generate another option," the agent creates it and pushes it into the live deck via SSE — no page reloads, no lost state.

## Install

```bash
pi install npm:pi-design-deck
```

Restart pi to load the extension and the bundled `design-deck` skill.

**Requirements:**
- pi-agent v0.35.0 or later (extensions API)
- Optional on macOS: `glimpseui` for native window launch (`npm install -g glimpseui`)

https://github.com/user-attachments/assets/aff1bac6-8bc2-461a-8828-f588ce655f7f

## Quick Start

The agent builds slides as JSON. Each slide is one decision, each option is one approach:

```json
{
  "title": "API Design",
  "slides": [
    {
      "id": "auth",
      "title": "Authentication Strategy",
      "context": "Choose how users authenticate with the API.",
      "columns": 2,
      "options": [
        {
          "label": "JWT + Refresh Tokens",
          "description": "Stateless, horizontally scalable",
          "aside": "Tokens are self-contained — no session store needed.\nWatch for token size with many claims.",
          "previewBlocks": [
            { "type": "code", "code": "const token = jwt.sign({ sub: user.id }, SECRET, { expiresIn: '15m' });\nres.cookie('refresh', refreshToken, { httpOnly: true });", "lang": "ts" },
            { "type": "mermaid", "content": "sequenceDiagram\n  Client->>API: POST /login\n  API->>Client: JWT + refresh cookie\n  Client->>API: GET /data (Bearer JWT)\n  API->>Client: 200 OK" }
          ],
          "recommended": true
        },
        {
          "label": "Session Cookies",
          "description": "Server-side sessions with Redis backing",
          "aside": "Simple mental model. Session invalidation is instant.\nRequires sticky sessions or shared session store.",
          "previewBlocks": [
            { "type": "code", "code": "app.use(session({ store: new RedisStore({ client }), secret: SECRET }));", "lang": "ts" },
            { "type": "mermaid", "content": "sequenceDiagram\n  Client->>API: POST /login\n  API->>Redis: Store session\n  API->>Client: Set-Cookie: sid=...\n  Client->>API: GET /data (Cookie)\n  API->>Redis: Lookup session" }
          ]
        }
      ]
    }
  ]
}
```

The browser opens, the user picks "JWT + Refresh Tokens", and the agent receives:

```
{ "auth": "JWT + Refresh Tokens" }
```

## Features

- **Preview blocks**: Four typed block types — `code` (Prism.js syntax highlighting), `mermaid` (Mermaid.js diagrams), `html` (raw HTML), and `image` (served from disk). Mix freely within one option.
- **Raw HTML previews**: Full `previewHtml` support for custom UI mockups with inline styles. Use when blocks aren't enough.
- **Generate-more loop**: Users click "Generate another option" and the agent pushes a new option into the live deck via SSE. No page reload.
- **Model selector**: Dropdown to pick which model generates new options. Save as default, or override per-request.
- **Thinking level**: Adjust reasoning effort for option generation when the selected model supports it.
- **Slide columns**: `columns` property (1, 2, 3, or 4) per slide. Auto-detected from option count if omitted.
- **Smart rebalancing**: Grid layout recalculates after generate-more adds options to minimize orphans.
- **Option aside**: Explanatory text rendered below the preview. Supports `\n` for line breaks.
- **Save/load snapshots**: `Cmd+S` saves the deck to disk. Use `action: "list"` to enumerate saved decks, `action: "open"` to reopen one by deck ID, or pass a file path to `slides`.
- **Notes persistence**: Saved decks include selected-option notes and summary-slide final instructions, and reopening restores both from disk.
- **Standalone HTML export**: `action: "export"` writes a read-only `export.html` next to the saved deck snapshot.
- **Light/dark/auto theme**: Full theme toggle with `Cmd+Shift+L` (configurable). Persists in localStorage.
- **Heartbeat watchdog**: Server detects lost browser connections (60s grace) and cleans up.
- **Idle timeout**: 5-minute inactivity timer after generate-more. Closes the deck if the agent doesn't respond.
- **Escape confirmation**: Pressing Escape with existing selections shows a confirmation bar before cancelling.
- **ARIA / keyboard**: `role="radiogroup"` on options, arrow key navigation, Space/Enter to select, number keys for quick pick.

## How It Works

1. Agent calls `design_deck()` with slides JSON — local HTTP server starts, opens in Glimpse on macOS when available, otherwise opens in the browser
2. User navigates slides, picks one option per slide
3. Optionally clicks "Generate N options" — agent generates and pushes via `add-options`, deck stays open
4. User submits — selections returned to agent as `{ slideId: "selected label" }`

The server persists across tool re-invocations. When generate-more fires, the tool resolves with instructions for the agent to create a new option. The browser shows a skeleton placeholder with shimmer animation until the new option arrives via SSE.

## Slides

### previewBlocks vs previewHtml

Every option needs exactly one of `previewBlocks` or `previewHtml` (not both, not neither).

**previewBlocks** — structured array of typed blocks, rendered in order:

| Block | Required Fields | Description |
|-------|----------------|-------------|
| `code` | `code`, `lang` | Syntax-highlighted code (Prism.js + autoloader) |
| `mermaid` | `content` | Mermaid diagram. Optional `theme` object for per-block overrides |
| `html` | `content` | Raw HTML snippet |
| `image` | `src`, `alt` | Image from disk (absolute path). Optional `caption` |

```json
{
  "previewBlocks": [
    { "type": "mermaid", "content": "graph TD\n  A-->B-->C" },
    { "type": "code", "code": "export default router;", "lang": "ts" },
    { "type": "html", "content": "<div style='color:#888'>Implementation notes...</div>" }
  ]
}
```

**previewHtml** — raw HTML string injected directly into the preview container. Full control over styling:

```json
{
  "previewHtml": "<div style='font-family: system-ui; padding: 16px'><h3>Dashboard Layout</h3><div style='display: grid; grid-template-columns: 200px 1fr'>...</div></div>"
}
```

### Image Blocks

Image blocks reference absolute file paths. The server copies each file into a temp directory and serves it via `/assets/` — the browser never sees the original path. Cleanup happens when the deck closes.

### Columns

Each slide supports `columns: 1 | 2 | 3 | 4` to control the grid layout. Omit it and the deck auto-detects based on option count. Use `columns: 1` for wide architecture diagrams, `columns: 2` for side-by-side comparisons, `columns: 4` for many small items.

### Aside

The `aside` field renders explanatory text below the preview with styled typography. Use `\n` for line breaks. Good for trade-off summaries, pros/cons, or implementation notes that complement the visual preview.

### Reserved IDs

The slide ID `"summary"` is reserved for the built-in summary slide that appears after all user slides. Don't use it.

## Generate-More Loop

When the user clicks "Generate N options," the tool resolves with a structured prompt telling the agent which slide needs options, how many, what options already exist, and what format to use. The agent generates the requested options and pushes them all at once:

```typescript
design_deck({
  action: "add-options",
  slideId: "arch",
  options: '[{"label": "Serverless", "previewBlocks": [...]}, {"label": "Edge", "previewBlocks": [...]}]'
})
```

The browser shows the new options with entry animations. The `add-options` call blocks until the next user action (submit, cancel, or another generate-more).

### Model Override

The deck shows a model dropdown when 2+ models are available. Users pick which model generates new options. When a model other than the current one is selected, the generate-more result instructs the agent to use the built-in `deck_generate` tool, which spawns pi headlessly with that model.

The default model can be set in the UI (saved to settings) or in `settings.json`:

```json
{
  "designDeck": {
    "generateModel": "google/gemini-3.1-pro"
  }
}
```

Priority: browser selection > settings default > current model.

### Prompt Input

An optional text input next to the generate button lets users provide instructions that flow through to the agent (e.g., "make it more minimal" or "use WebSockets instead").

## Saving and Loading

**Manual save:** Press `Cmd+S` (or `Ctrl+S`) at any time to save the current deck state to disk.

**Auto-save on submit:** Enabled by default. Saves a snapshot after successful submission with a `-submitted` suffix.

**Auto-save on cancel:** If you cancel a deck that has selections, it's automatically saved with a `-cancelled` suffix. This makes it easy to recover work if you accidentally close the tab or change your mind.

**Loading a saved deck:**
```typescript
design_deck({ slides: "~/.pi/deck-snapshots/api-design-myapp-main-2026-02-22-143000/deck.json" })
```

The deck opens with selections pre-populated and image paths resolved relative to the snapshot directory.

**Listing saved decks:**
```typescript
design_deck({ action: "list" })
```

**Opening by deck ID:**
```typescript
design_deck({ action: "open", deckId: "api-design-myapp-main-2026-02-22-143000-submitted" })
```

**Exporting standalone HTML:**
```typescript
design_deck({ action: "export", deckId: "api-design-myapp-main-2026-02-22-143000-submitted", format: "html" })
```

**Snapshot structure:**
```
~/.pi/deck-snapshots/
  {title}-{project}-{branch}-{date}-{time}[-submitted|-cancelled]/
    deck.json           # Config + selections + metadata
    images/             # Copied image assets (relative paths in JSON)
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Arrow keys` | Navigate slides (left/right) or options within a slide (up/down) |
| `Space` / `Enter` | Select focused option |
| `1`-`9` | Quick-select option by number |
| `Enter` (on last slide) | Submit |
| `Cmd+S` | Save deck snapshot |
| `Cmd+Shift+L` | Toggle theme (configurable) |
| `Escape` | Cancel (confirmation bar if selections exist) |

## Configuration

Settings in `~/.pi/agent/settings.json` under the `designDeck` key:

```json
{
  "designDeck": {
    "port": 0,
    "browser": "chrome",
    "snapshotDir": "~/.pi/deck-snapshots",
    "autoSaveOnSubmit": true,
    "generateModel": "google/gemini-3.1-pro",
    "theme": {
      "mode": "dark",
      "toggleHotkey": "mod+shift+l"
    }
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `port` | `0` (random) | Fixed port for the deck server |
| `browser` | System default | Browser app to open (e.g., `"chrome"`, `"firefox"`) |
| `snapshotDir` | `~/.pi/deck-snapshots` | Directory for saved deck snapshots |
| `autoSaveOnSubmit` | `true` | Auto-save snapshot on successful submit |
| `generateModel` | — | Default model for generate-more (e.g., `"google/gemini-3.1-pro"`) |
| `theme.mode` | `"dark"` | `"dark"`, `"light"`, or `"auto"` (follows OS) |
| `theme.toggleHotkey` | `"mod+shift+l"` | Hotkey string to toggle theme |

**Migration:** If you previously had `deckGenerateModel` under the `interview` key, it's automatically migrated to `designDeck.generateModel` on first load.

## Tool Parameters

The agent handles these when you use the slash commands or ask in natural language. This documents the underlying tool API.

| Parameter | Type | Description |
|-----------|------|-------------|
| `slides` | string | JSON string of deck config, or file path to a saved deck |
| `action` | `"add-options"` \| `"add-option"` \| `"replace-options"` \| `"list"` \| `"open"` \| `"export"` | Push/replace options, list saved decks, reopen a saved deck, or export one |
| `slideId` | string | Target slide ID (required with actions) |
| `option` | string | JSON string of one option (required with `add-option`) |
| `options` | string | JSON string of option array (required with `add-options` or `replace-options`) |
| `deckId` | string | Saved deck ID from `action: "list"` (required with `open` / `export`) |
| `format` | string | Export format for `action: "export"` (`"html"` currently supported) |

Six modes of invocation:
1. **Start a new deck:** `design_deck({ slides: "<JSON>" })`
2. **Add options to running deck:** `design_deck({ action: "add-options", slideId: "...", options: "<JSON array>" })` — blocks until next user action
3. **Add single option (non-blocking):** `design_deck({ action: "add-option", slideId: "...", option: "<JSON>" })`
4. **Replace all options on a slide:** `design_deck({ action: "replace-options", slideId: "...", options: "<JSON array>" })`
5. **List saved decks:** `design_deck({ action: "list" })`
6. **Open or export a saved deck:** `design_deck({ action: "open" | "export", deckId: "..." })`

## File Structure

```
pi-design-deck/
├── index.ts             # Tool registration, module-level state, lifecycle
├── generate-prompts.ts  # Prompt builders for generate-more / regenerate
├── model-runner.ts      # Headless pi spawner for deck_generate tool
├── deck-schema.ts       # TypeScript types and validation (no dependencies)
├── deck-server.ts       # HTTP server, SSE, asset serving, snapshots
├── server-utils.ts      # Shared HTTP/session utilities
├── settings.ts          # Settings with designDeck namespace + migration
├── schema.test.ts       # 48 tests across 3 describe blocks
├── form/
│   ├── deck.html        # HTML template (loads CSS/JS, Prism, Mermaid)
│   ├── css/             # Theme variables, layout, preview blocks, controls
│   └── js/              # Client: state, rendering, interaction, session
├── prompts/
│   ├── deck.md          # /deck — general purpose
│   ├── deck-plan.md     # /deck-plan — design from plan/PRD
│   └── deck-discover.md # /deck-discover — interview then design
└── skills/
    └── design-deck/
        └── SKILL.md     # Agent skill for on-demand loading
```

## Bundled Skill

The extension includes a `design-deck` skill at `skills/design-deck/SKILL.md` that teaches the agent when and how to use the design deck effectively — discovery-first vs deck-direct, slide structure, previewBlocks vs previewHtml, the generate-more loop, and model override patterns.

The skill is declared in `package.json` under `pi.skills` and is automatically discovered when the extension is installed. No manual copying needed.

### Component Gallery Reference

The skill includes a reference library for 60 UI components with best practices, common layouts, and aliases. Each component links to [component.gallery](https://component.gallery) where the agent can browse real screenshots when needed.

**Before:** "Show me collapse options" → agent might not connect that to accordion, or know what components are available for the use case.

**After:** Agent has 60 components to suggest from. Knows *collapse = accordion = disclosure = expander*. Knows *Blueprint = dense, dark-native; Ant = clean, blue primary.* Can browse [100+ real implementations](https://component.gallery/components/accordion/) when it needs concrete references.

The reference enables discovery (find/suggest components), cross-referencing (connect related terms), and design vocabulary (know what systems look like) — plus guidance on *when* to show distinct design systems vs variations of one style.

A separate vocabulary lookup (`LOOKUP.md`) resolves ambiguous user terms to canonical components. When a user says "dropdown" (Select? Combobox? Dropdown menu?) or "popup" (Modal? Popover? Tooltip?) or describes intent ("I need something that expands"), the agent can consult the lookup to understand what they mean and ask the right clarifying questions when needed.

## Limitations

- Only one deck can be active at a time. Complete or cancel before starting another.
- Image blocks require absolute file paths on disk (no URLs).
- The `summary` slide ID is reserved and cannot be used for custom slides.
- Mermaid diagrams load from CDN — requires internet on first load.
- macOS tested primarily; Linux and Windows support is best-effort.

## Credits

UI component reference data sourced from [component.gallery](https://component.gallery) by Iain Bean.
