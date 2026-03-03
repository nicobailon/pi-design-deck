import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveDeckStatusFromFolderName, type DeckOption, type DeckSlide, type PreviewBlock, type SavedDeckData, type SelectionValue } from "./deck-schema.js";

const FORM_DIR = join(dirname(fileURLToPath(import.meta.url)), "form");
const CSS_FILES = ["variables", "layout", "preview", "controls"];
const EMBEDDED_CSS = CSS_FILES
	.map((name) => readFileSync(join(FORM_DIR, "css", `${name}.css`), "utf-8"))
	.join("\n");

const GOOGLE_FONTS_LINK = "https://fonts.googleapis.com/css2?family=Albert+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Fira+Code:wght@400;500&family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Outfit:wght@400;500;600;700&family=Space+Mono:wght@400;500;600&display=swap";

const IMAGE_MIME_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".avif": "image/avif",
};

const EXPORT_CSS = `
body {
	margin: 0;
	background: var(--dk-bg);
	color: var(--dk-text);
}

.deck {
	min-height: 100vh;
}

.deck-header {
	position: static;
}

.progress,
.deck-footer,
.deck-loading,
.confirm-bar,
.deck-close-overlay,
.save-toast,
.model-bar,
.gen-bar {
	display: none !important;
}

.slides-wrap {
	display: flex;
	flex-direction: column;
	gap: 24px;
	padding: 24px;
}

.slide {
	display: block !important;
	opacity: 1 !important;
	transform: none !important;
	max-width: 1400px;
	margin: 0 auto;
}

.option {
	cursor: default;
}

.option:hover {
	transform: none;
}

.export-meta {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
	margin-top: 12px;
}

.export-chip {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding: 6px 10px;
	border-radius: 999px;
	border: 1px solid rgba(var(--dk-ink),0.12);
	background: rgba(var(--dk-ink),0.06);
	font: 11px var(--dk-font-mono);
	color: var(--dk-text-secondary);
}

.export-chip-label {
	color: var(--dk-text-hint);
	text-transform: uppercase;
	letter-spacing: 0.08em;
}

.export-selected-badge {
	margin-left: auto;
	padding: 2px 8px;
	border-radius: 999px;
	background: rgba(52,211,153,0.12);
	color: var(--dk-status-success);
	font: 10px var(--dk-font-mono);
	text-transform: uppercase;
	letter-spacing: 0.08em;
}

.export-final-notes {
	max-width: 1400px;
	margin: 0 auto 24px;
}

.export-final-notes-body {
	margin-top: 12px;
	padding: 16px 18px;
	border-radius: 12px;
	background: rgba(var(--dk-ink),0.06);
	border: 1px solid rgba(var(--dk-ink),0.1);
	white-space: pre-wrap;
	line-height: 1.6;
}

.summary-notes {
	margin-top: 12px;
}

.summary-notes-label {
	font-weight: 600;
}

.preview-block-mermaid {
	overflow: hidden;
}

.preview-block-mermaid svg {
	max-width: 100%;
	height: auto;
}

@media (max-width: 900px) {
	.slides-wrap {
		padding: 16px;
	}

	.export-meta {
		gap: 8px;
	}
}
`;

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function optionCountClass(count: number, columns?: 1 | 2 | 3): string {
	if (columns === 1) return "cols-1";
	if (columns && count >= columns && count % columns !== 1) {
		return `cols-${columns}`;
	}
	if (count <= 1) return "cols-1";
	if (count === 2 || count === 4) return "cols-2";
	return "cols-3";
}

function formatTimestamp(value?: string): string {
	if (!value) return "";
	try {
		return new Date(value).toLocaleString();
	} catch {
		return value;
	}
}

function inlineImageSrc(src: string, baseDir: string): string {
	if (/^(data:|https?:|file:|blob:)/i.test(src)) {
		return src;
	}

	const absolutePath = resolve(baseDir, src);
	if (!existsSync(absolutePath)) {
		return src;
	}

	const mimeType = IMAGE_MIME_TYPES[extname(absolutePath).toLowerCase()] || "application/octet-stream";
	const data = readFileSync(absolutePath).toString("base64");
	return `data:${mimeType};base64,${data}`;
}

function renderPreviewBlocks(blocks: PreviewBlock[], baseDir: string): string {
	return blocks.map((block) => {
		if (block.type === "html") {
			return `<div class="preview-block preview-block-html">${block.content}</div>`;
		}
		if (block.type === "mermaid") {
			return `<div class="preview-block preview-block-mermaid"><div class="mermaid">${escapeHtml(block.content)}</div></div>`;
		}
		if (block.type === "code") {
			return `<div class="preview-block preview-block-code"><pre><code class="language-${escapeHtml(block.lang)}">${escapeHtml(block.code)}</code></pre></div>`;
		}
		const imageSrc = inlineImageSrc(block.src, baseDir);
		return `<div class="preview-block preview-block-image"><img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(block.alt)}" loading="lazy">${block.caption ? `<div class="preview-block-caption">${escapeHtml(block.caption)}</div>` : ""}</div>`;
	}).join("");
}

function renderOption(option: DeckOption, slideId: string, selectedLabel: SelectionValue | undefined, note: string | undefined, baseDir: string): string {
	const isSelected = Array.isArray(selectedLabel) ? selectedLabel.includes(option.label) : selectedLabel === option.label;
	const previewContent = Array.isArray(option.previewBlocks) && option.previewBlocks.length > 0
		? renderPreviewBlocks(option.previewBlocks, baseDir)
		: option.previewHtml || "";

	return `
		<article class="option${isSelected ? " selected" : ""}" role="presentation" data-slide-id="${escapeHtml(slideId)}">
			<div class="option-check">&#10003;</div>
			<div class="option-header">
				<span class="option-radio"></span>
				<span class="option-label">${escapeHtml(option.label)}</span>
				${isSelected ? `<span class="export-selected-badge">Selected</span>` : option.recommended ? `<span class="rec-badge">Recommended</span>` : ""}
			</div>
			<div class="preview${Array.isArray(option.previewBlocks) && option.previewBlocks.length > 0 ? " preview-blocks" : ""}">${previewContent}</div>
			<div class="option-footer">
				${option.aside ? `<div class="option-aside">${escapeHtml(option.aside).replace(/\\n/g, "<br>").replace(/\n/g, "<br>")}</div>` : ""}
				${isSelected && note ? `<div class="summary-notes"><span class="summary-notes-label">Your notes:</span> ${escapeHtml(note)}</div>` : ""}
			</div>
		</article>
	`;
}

function renderSlide(slide: DeckSlide, savedDeck: SavedDeckData, slideIndex: number, baseDir: string): string {
	const selectedLabel = savedDeck.selections[slide.id];
	const note = savedDeck.notes?.[slide.id];
	return `
		<section class="slide active" data-id="${escapeHtml(slide.id)}" data-slide="${slideIndex}">
			<span class="slide-step">${slideIndex + 1} / ${savedDeck.config.slides.length}</span>
			<h2>${escapeHtml(slide.title)}</h2>
			${slide.context ? `<p class="slide-context">${escapeHtml(slide.context)}</p>` : ""}
			<div class="options ${optionCountClass(slide.options.length, slide.columns)}">
				${slide.options.map((option) => renderOption(option, slide.id, selectedLabel, note, baseDir)).join("")}
			</div>
		</section>
	`;
}

function renderMetaChip(label: string, value: string): string {
	return `<div class="export-chip"><span class="export-chip-label">${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`;
}

export function buildStandaloneDeckHtml(deckPath: string, savedDeck: SavedDeckData): string {
	const baseDir = dirname(deckPath);
	const deckId = savedDeck.id || basename(baseDir) || "deck";
	const status = savedDeck.status || deriveDeckStatusFromFolderName(deckId);
	const hasMermaid = savedDeck.config.slides.some((slide) =>
		slide.options.some((option) =>
			Array.isArray(option.previewBlocks) && option.previewBlocks.some((block) => block.type === "mermaid")
		)
	);
	const title = savedDeck.config.title || "Design Deck";
	const metaChips = [
		renderMetaChip("deck", deckId),
		renderMetaChip("status", status),
		renderMetaChip("saved", formatTimestamp(savedDeck.savedAt)),
		renderMetaChip("modified", formatTimestamp(savedDeck.modifiedAt || savedDeck.savedAt)),
	];
	if (savedDeck.savedFrom?.cwd) {
		metaChips.push(renderMetaChip("cwd", savedDeck.savedFrom.cwd));
	}
	if (savedDeck.savedFrom?.branch) {
		metaChips.push(renderMetaChip("branch", savedDeck.savedFrom.branch));
	}

	const mermaidScript = hasMermaid
		? `
	<script type="module">
		import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
		mermaid.initialize({
			startOnLoad: false,
			theme: 'base',
			themeVariables: {
				background: '#1a1a22',
				primaryColor: '#2a3f3d',
				primaryTextColor: '#e0e0e0',
				primaryBorderColor: '#8abeb7',
				lineColor: '#555555',
				secondaryColor: '#1e2a2e',
				tertiaryColor: '#1a1a22',
				noteBkgColor: '#222230',
				noteTextColor: '#b0b0b0',
				fontSize: '13px',
				fontFamily: "'Space Mono', monospace",
			}
		});
		mermaid.run({ querySelector: '.mermaid' });
	</script>`
		: "";

	return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta name="theme-color" content="#18181e">
	<title>${escapeHtml(title)} - Export</title>
	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
	<link href="${GOOGLE_FONTS_LINK}" rel="stylesheet">
	<style>${EMBEDDED_CSS}
${EXPORT_CSS}</style>
</head>
<body>
	<div class="deck">
		<header class="deck-header">
			<div class="deck-meta">
				<h1 class="deck-title">${escapeHtml(title)}</h1>
				<div class="export-meta">${metaChips.join("")}</div>
			</div>
		</header>
		<div class="slides-wrap">
			${savedDeck.config.slides.map((slide, index) => renderSlide(slide, savedDeck, index, baseDir)).join("")}
			${savedDeck.finalNotes ? `<section class="slide active export-final-notes"><span class="slide-step">Notes</span><h2>Additional Instructions</h2><div class="export-final-notes-body">${escapeHtml(savedDeck.finalNotes)}</div></section>` : ""}
		</div>
	</div>
	${mermaidScript}
</body>
</html>`;
}
