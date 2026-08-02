# Changelog

## [Unreleased]

### Fixed
- Remote/Moshi discovery now matches the field-tested flow: tokenless loopback `GET /` serves a stateless `200` landing shell, `HEAD /` answers discovery probes, non-loopback `Host` headers are rejected, and deck servers prefer Moshi-discoverable low ports before falling back to ephemeral ports.
- Deck session registry temp writes are forced to owner-only permissions before rename.

### Changed
- Remote access hints now use a nonblocking active-login probe and distinguish host-opened browser windows from launch failures.

## [0.5.0] - 2026-08-01

### Added
- Remote-session support: tokenless `GET /` from loopback now redirects to the tokenized deck URL when the request is a top-level navigation, so Moshi's browser preview (getmoshi.app) opens the deck with one tap over its SSH forward. Page-driven cross-origin fetches still get 403.
- When the browser can't be opened locally or the session looks remote (ssh/mosh), the tool now prints the deck URL with tailored hints: a Moshi preview tip (when the moshi-hook gateway is detected), an `ssh -L` port-forward command, and a mosh caveat.

### Changed
- A failed browser launch no longer cancels the deck; the server stays up so the deck can be opened from another device. The launch error is included in the hint. The native Glimpse window is skipped when the session looks remote.

## [0.4.0] - 2026-07-31

### Performance
- Deck pages now load Prism only when the deck contains code preview blocks, and load Mermaid lazily on the first Mermaid block (including generated options). HTML-only decks skip ~190 KB of CDN assets and load ~45% faster on constrained networks.
- Slide navigation updates the active slide in O(1) instead of sweeping every slide element (~30% faster on large decks).
- Standalone HTML export encodes each repeated local image once per export (~2x faster for image-heavy decks, byte-identical output).
- Inline deck JSON is escaped in a single pass (~2.6x faster on large decks).

### Fixed
- Deck content containing `$&`, `$'`, or `$$` sequences no longer corrupts the inlined deck data or page title during template substitution.
- Switched local TypeScript imports to `.ts` specifiers for current Pi extension loading.
- Replaced the `design_deck` action schema union with `StringEnum` for provider-compatible tool schemas.

### Changed
- Updated Pi extension imports and package metadata for the `@earendil-works/*` package scope.
- Moved Pi-provided runtime packages to peer dependencies so packaged installs use Pi's bundled extension runtime.

## [0.3.6] - 2026-04-22

### Fixed
- Migrated extension tool schemas from `@sinclair/typebox` to `typebox` 1.x so packaged installs follow Pi's current extension runtime contract.

### Changed
- Added `typebox` as a runtime dependency for packaged installs.

## [0.3.5] - 2026-04-04

### Changed
- Added `promptSnippet` metadata for `design_deck` and `deck_generate` so current pi versions consistently include both tools in the default model-visible tool prompt.

## [0.3.4] - 2026-03-16

### Fixed
- **Auto-correct misrouted action params**: When the agent passes `action`/`deckId` inside the `slides` JSON string instead of as top-level parameters, the tool now detects and promotes them automatically instead of failing with a validation error.

## [0.3.3] - 2026-03-15

### Added
- **Glimpse integration on macOS**: New deck sessions now open in a native Glimpse window when `glimpseui` is available.

### Fixed
- **Responsive footer**: Nav buttons no longer wrap text or squish at narrow widths. Keyboard hints hide below 1100px, layout toggle hides below 600px, footer padding tightens on mobile.

### Changed
- **Graceful launch fallback**: When Glimpse is unavailable or fails to open, deck startup falls back to the existing browser launch flow.
- **Window lifecycle cleanup**: Deck cleanup paths now close the active Glimpse window so submit/cancel/abort/shutdown flows do not leave orphan native windows.

## [0.3.2] - 2026-03-11

### Fixed
- **Skeleton spinner centering**: Spinners in generate-more skeleton cards drifted off-center because the `@keyframes spin` animation overwrote the `transform: translate(-50%, -50%)` used for centering. Replaced with `inset: 0; margin: auto;` which avoids the transform conflict entirely.
- **Variable shadowing**: Renamed two `const current` locals in the frontend JS that shadowed the global slide-index variable — `stored` in the layout toggle handler, `entry` in the generate-more timeout callback.

## [0.3.1] - 2026-03-10

### Added
- **Loading spinners**: Generate-more shows spinner inside skeleton cards; regenerate-all shows centered spinner overlay with backdrop blur and "Regenerating options..." text.
- **Layout toggle**: Footer toolbar with 1/2/3/4 column buttons. Overrides per-slide column settings globally. Click active button to return to auto-layout. Persists to localStorage.
- **4-column layout**: Agents can now set `columns: 4` per slide for compact grids (icon sets, color swatches, etc.).

## [0.3.0] - 2026-03-02

### Added
- **`add-options` action**: New batched action that pushes multiple options in one call and blocks for next user action. Replaces multiple `add-option` calls for generate-more requests. More elegant — single call, automatic blocking, no agent coordination needed.
- **Deck persistence actions**: `list` to enumerate saved decks, `open` to reopen by deck ID, and `export` to generate standalone HTML from a saved snapshot.
- **Saved deck metadata**: Snapshots now persist `id`, `status`, `modifiedAt`, selected-option notes, and final instructions for reopen/export flows.
- **Standalone HTML export**: Saved decks can be written to `export.html` for read-only review without the live server.
- **Component Gallery Reference**: Added `skills/design-deck/references/component-gallery/` with 60 UI component patterns
  - Enables discovery (find/suggest components for a use case), cross-referencing (collapse = accordion = disclosure), and design vocabulary (Blueprint = dense, dark-native)
  - `components.md` with best practices, common layouts, and aliases for every major component
  - `INDEX.md` with design system vocabulary table and context-aware guidance (distinct systems vs variations)
- **Modular design system examples**: `components/` subdirectory with 2,676 real-world implementations scraped from component.gallery
  - 8 category files: actions, navigation, inputs, data-display, feedback, overlays, layout, utilities
  - Each entry includes design system name, direct documentation URL, tech stack, features, and preview image link
  - Organized by design system within each component for easy comparison (Ant Design vs Blueprint vs Carbon, etc.)
- **Vocabulary Lookup**: `LOOKUP.md` resolves ambiguous user terms to canonical component names
  - Alias index with 150+ term mappings (collapse → Accordion, snackbar → Toast, etc.)
  - Disambiguation rules for ambiguous terms (dropdown, popup, loading, notification, menu, sidebar, list, panel, chip, picker)
  - Intent clusters for goal-based mapping ("I need users to pick from options" → Radio, Select, Combobox)
  - Clarification templates for when disambiguation needs user input
  - Platform-specific term translations (iOS action sheet → Drawer, Material snackbar → Toast)
  - Common confusion reference (Select vs Combobox, Modal vs Drawer, Alert vs Toast, etc.)
- Updated SKILL.md, deck prompts, and README to reference component gallery
- Credit to [component.gallery](https://component.gallery) by Iain Bean

### Changed
- **Manual save payload**: `Cmd+S` / Save button now persists selected-option notes and final instructions, not just selections.
- **Saved deck restoration**: Opening a saved deck now restores notes and final instructions from disk instead of depending on localStorage.

## [0.2.0] - 2026-02-27

### Added
- **Generate multiple options at once**: Dropdown to select 1, 2, or 3 options. Agent makes parallel add-option calls.
- **Per-option notes**: Each option card has an optional "Your notes" textarea. Notes are included in submission.
- **Final instructions**: Summary slide has "Additional instructions" textarea for implementation guidance.

### Changed
- **Stronger generate-more prompts**: Instructions now explicitly state "YOU MUST" generate options, warning against skipping.
- **`close()` accepts reason parameter**: Server handle's `close()` method accepts optional reason string for different browser messages.
- **Improved regenerate-all transition**: Skeleton overlay with shimmer animation covers existing options during regeneration.

### Fixed
- **Parallel add-option calls**: Fixed bug where only the first of multiple parallel calls succeeded. Now returns immediately without blocking.
- **Partial generation timeout**: 30-second timeout per option with "Generated X of Y" toast if fewer arrive than requested.
- **Deck closes when agent disconnects**: Now shows "Session ended — lost connection" instead of leaving deck unresponsive.
- **Default checkbox on "Current" pill**: Can now set current model as default without reselecting from provider list.
- **Default checkbox error handling**: API errors are logged and checkbox reverts to actual state.
- **Summary slide aside line breaks**: Now correctly renders `\n` as line breaks, matching option cards.
- **Preview inline styles preserved**: `previewHtml` wrapper div inline styles are now correctly applied.
- **Skeleton cleanup**: Queries DOM directly instead of relying on mutated array.
- **Silent generation failures**: Browser shows toast for all failure cases, not just timeouts.
- **Abort shows correct message**: Shows "Session was ended by the agent" instead of generic message.
- **Notes persisted across refresh**: Option notes and final instructions saved to localStorage.
- **Stale notes cleared on regeneration**: Old notes cleared to prevent appearing on new options.

## [0.1.1] - 2026-02-23

### Added
- **`deck_generate` tool**: Built-in model delegation for generate-more. Spawns pi headlessly with `--provider`/`--model` flags. No subagent extension required.
- **Generated-by badge**: Shows "Generated by {model}" on options created with a model override.
- **Demo video** in README.

### Changed
- Removed option dimming effect — unselected options now stay at full opacity after selection.
- Simplified "How It Works" section — removed ASCII diagram.

### Fixed
- **`deck_generate` execute signature**: Tool now uses correct `(toolCallId, params)` signature instead of destructured params.

## [0.1.0] - 2026-02-23

### Added
- **Design Deck tool** (`design_deck`): Multi-slide visual option picker for design decisions. Each slide presents 2-4 options with high-fidelity HTML previews. Users select one option per slide and submit. Persistent server architecture keeps the browser open across tool re-invocations, enabling the generate-more loop without page reloads.
- **Generate-more loop**: Users can request additional options from the agent. Clicking "Generate another option" resolves the tool without closing the server. The agent generates a new option and re-invokes `design_deck` with `action: "add-option"` to push it into the live deck via SSE. Skeleton placeholder with shimmer animation shown during generation.
- **Preview blocks**: `previewBlocks` array as an alternative to raw `previewHtml`. Four typed block types: `html`, `mermaid` (Mermaid.js), `code` (Prism.js syntax highlighting), and `image` (served from disk via temp assets directory). Exactly one of `previewHtml` or `previewBlocks` required per option.
- **Option aside**: Optional `aside` field renders explanatory text below the preview. HTML-escaped with `\n` to `<br>` conversion. Truncated to 120 chars in summary cards.
- **Mermaid.js integration**: CDN-loaded Mermaid v11 with dark-mode base theme. Per-block theme overrides. Async rendering with ready-queue.
- **Prism.js integration**: CDN-loaded Prism with autoloader for on-demand language grammars.
- **Image asset serving**: `/assets/` route with UUID-named temp directory, path traversal guard, cleanup on close.
- **Slide columns**: `columns` property (1, 2, or 3) for layout control. Smart column rebalancing to minimize orphans.
- **Light/dark/auto theme**: CSS custom properties, toggle hotkey, localStorage persistence, `prefers-color-scheme` support.
- **Save/load snapshots**: `Cmd+S` manual save, auto-save on submit/cancel, reload from file path with pre-populated selections.
- **Heartbeat watchdog**: 60s grace period for lost browser connections. `beforeunload` beacon on tab close.
- **Idle timeout**: 5-minute timer after generate-more. Closes deck if the agent doesn't respond.
- **Abort handling**: Agent abort signal cleanly closes the deck at any point in the lifecycle.
- **Keyboard navigation**: Arrow keys, Space/Enter selection, number keys 1-9, Escape confirmation bar.
- **ARIA accessibility**: `role="radiogroup"`, `aria-checked`, `aria-live`, roving tabindex, `:focus-visible` outlines.
- **Slash commands**: `/deck`, `/deck-plan`, `/deck-discover` prompt templates.
- **Bundled skill**: `design-deck` skill with format reference, preview guidance, and generate-more patterns.
- **48 schema tests**: Covering config validation, `isDeckOption`, saved deck loading, block types, edge cases.

### Fixed
- **Generate-more failure recovery**: `pushOption` errors now clear `pendingGenerate` state and push `generate-failed` SSE event.
- **`isDeckOption` deep block validation**: Validates each `previewBlocks` entry, not just array presence.
- **Atomic settings writes**: Temp-file + rename pattern for `saveGenerateModel()` and settings migration.
