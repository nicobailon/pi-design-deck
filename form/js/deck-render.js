// ─── MERMAID RENDERING ───────────────────────────────────────

let mermaidReady = false;
let mermaidPromise = null;
const mermaidQueue = [];

function loadMermaid() {
	if (mermaidPromise) return;
	mermaidPromise = import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs")
		.then(({ default: mermaid }) => {
			window.__mermaid = mermaid;
			mermaid.initialize({
				startOnLoad: false,
				theme: "base",
				themeVariables: {
					background: "#1a1a22",
					primaryColor: "#2a3f3d",
					primaryTextColor: "#e0e0e0",
					primaryBorderColor: "#8abeb7",
					lineColor: "#555555",
					secondaryColor: "#1e2a2e",
					tertiaryColor: "#1a1a22",
					noteBkgColor: "#222230",
					noteTextColor: "#b0b0b0",
					fontSize: "13px",
					fontFamily: "'Space Mono', monospace",
				},
			});
			mermaidReady = true;
			for (const render of mermaidQueue.splice(0)) render();
		})
		.catch(() => {});
}

function whenMermaidReady(fn) {
	if (mermaidReady) {
		fn();
		return;
	}
	mermaidQueue.push(fn);
	loadMermaid();
}

let mermaidCounter = 0;

async function renderMermaidBlock(container, content, themeOverrides) {
	const mermaid = window.__mermaid;
	if (!mermaid) return;

	let finalContent = content;
	if (themeOverrides && Object.keys(themeOverrides).length > 0) {
		const vars = Object.entries(themeOverrides)
			.map(([k, v]) => `    ${k}: '${v}'`)
			.join("\n");
		finalContent = `---\nconfig:\n  themeVariables:\n${vars}\n---\n${content}`;
	}

	const id = `mermaid-${++mermaidCounter}`;
	try {
		const { svg } = await mermaid.render(id, finalContent);
		container.innerHTML = svg;
	} catch {
		container.textContent = "Mermaid render error";
		container.style.color = "#f87171";
		container.style.fontSize = "12px";
		container.style.padding = "12px";
	}
	const slide = container.closest(".slide");
	if (slide) equalizeBlockHeights(slide);
}

const PRISM_THEME_URL = "https://cdn.jsdelivr.net/npm/prismjs@1/themes/prism-tomorrow.min.css";
const PRISM_CORE_URL = "https://cdn.jsdelivr.net/npm/prismjs@1/prism.min.js";
const PRISM_AUTOLOADER_URL = "https://cdn.jsdelivr.net/npm/prismjs@1/plugins/autoloader/prism-autoloader.min.js";
let prismPromise = null;

function loadScript(src) {
	return new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.src = src;
		script.onload = resolve;
		script.onerror = reject;
		document.head.appendChild(script);
	});
}

function loadPrism() {
	if (prismPromise) return prismPromise;
	if (window.Prism?.highlightElement) return Promise.resolve(window.Prism);

	if (!document.querySelector(`link[href="${PRISM_THEME_URL}"]`)) {
		const stylesheet = document.createElement("link");
		stylesheet.rel = "stylesheet";
		stylesheet.href = PRISM_THEME_URL;
		document.head.appendChild(stylesheet);
	}
	prismPromise = loadScript(PRISM_CORE_URL)
		.then(() => loadScript(PRISM_AUTOLOADER_URL))
		.then(() => window.Prism);
	return prismPromise;
}

function renderCodeBlock(container, code, lang) {
	const pre = document.createElement("pre");
	pre.tabIndex = -1;
	const codeEl = document.createElement("code");
	codeEl.className = `language-${lang}`;
	codeEl.textContent = code;
	pre.appendChild(codeEl);
	container.appendChild(pre);

	if (window.Prism?.highlightElement) {
		window.Prism.highlightElement(codeEl);
	} else {
		loadPrism().then((prism) => prism.highlightElement(codeEl)).catch(() => {});
	}
}

// ─── PREVIEW BLOCKS ──────────────────────────────────────────

const EXPAND_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function renderPreviewBlocks(preview, blocks, content) {
	preview.classList.add("preview-blocks");
	blocks.forEach((block, blockIndex) => {
		if (block.type === "html") {
			const wrapper = createElement("div", "preview-block preview-block-html");
			wrapper.innerHTML = block.content;
			content.appendChild(wrapper);
		} else if (block.type === "mermaid") {
			const wrapper = createElement("div", "preview-block preview-block-mermaid");
			wrapper.tabIndex = -1;
			content.appendChild(wrapper);
			whenMermaidReady(() => renderMermaidBlock(wrapper, block.content, block.theme));
		} else if (block.type === "code") {
			const wrapper = createElement("div", "preview-block preview-block-code");
			renderCodeBlock(wrapper, block.code, block.lang);
			content.appendChild(wrapper);
		} else if (block.type === "image") {
			const wrapper = createElement("div", "preview-block preview-block-image");
			// The frame is exactly the image's box, so image pins (x/y fractions) track it at any size.
			const frame = createElement("div", "image-frame");
			frame.dataset.blockIndex = String(blockIndex);
			const img = document.createElement("img");
			img.src = block.src;
			img.alt = block.alt;
			img.loading = "lazy";
			img.onload = () => { const s = wrapper.closest(".slide"); if (s) equalizeBlockHeights(s); };
			frame.appendChild(img);
			frame.appendChild(createElement("div", "pin-layer"));
			const expand = createElement("button", "image-expand");
			expand.type = "button";
			expand.title = "View full size";
			expand.setAttribute("aria-label", `View full size: ${block.alt}`);
			expand.innerHTML = EXPAND_ICON;
			expand.addEventListener("click", (event) => {
				event.stopPropagation();
				openImageViewer(expand.closest(".option"), blockIndex);
			});
			frame.appendChild(expand);
			wrapper.appendChild(frame);
			if (block.caption) {
				const cap = createElement("div", "preview-block-caption", block.caption);
				wrapper.appendChild(cap);
			}
			content.appendChild(wrapper);
		}
	});
}

function applyPreviewHtml(preview, previewHtml, content = preview) {
	if (typeof previewHtml !== "string") return;
	const trimmed = previewHtml.trim();
	if (!trimmed) return;

	const temp = document.createElement("div");
	temp.innerHTML = trimmed;
	const first = temp.firstElementChild;

	if (first && first.classList.contains("preview")) {
		const dataset = first.dataset || {};
		if (dataset.theme) {
			preview.dataset.theme = dataset.theme;
		}
		if (dataset.fonts) {
			preview.dataset.fonts = dataset.fonts;
		}
		// Copy inline styles from source preview div
		if (first.style.cssText) {
			preview.style.cssText = first.style.cssText;
		}
		content.innerHTML = first.innerHTML;
		return;
	}

	content.innerHTML = previewHtml;
}

// ─── OPTION CARDS ────────────────────────────────────────────

function optionCountClass(count, columns) {
	if (columns === 1) return "cols-1";
	if (columns && count >= columns && count % columns !== 1) {
		return `cols-${columns}`;
	}
	if (count <= 1) return "cols-1";
	if (count === 2 || count === 4) return "cols-2";
	return "cols-3";
}

function optionHint(count) {
	const max = Math.min(9, Math.max(1, count));
	const parts = [];
	for (let i = 1; i <= max; i += 1) {
		parts.push(`<kbd>${i}</kbd>`);
	}
	return `Choose one - press ${parts.join(" ")} or click`;
}

function createOptionCard(option, slideId, generatedBy) {
	const card = createElement("div", "option");
	card.setAttribute("role", "radio");
	card.setAttribute("aria-checked", "false");
	card.tabIndex = 0;
	if (generatedBy !== false) {
		card.classList.add("option-generated");
	}
	card.dataset.value = option.label;
	card.dataset.slideId = slideId;
	card.addEventListener("click", () => selectOption(card));

	const check = createElement("div", "option-check");
	check.innerHTML = "&#10003;";
	card.appendChild(check);

	const header = createElement("div", "option-header");	
	const radio = createElement("span", "option-radio");
	header.appendChild(radio);

	const label = createElement("span", "option-label", option.label);
	header.appendChild(label);

	if (generatedBy !== false) {
		const modelShort = generatedBy ? generatedBy.split("/").pop() : null;
		const badgeText = modelShort ? `Generated by ${modelShort}` : "Generated";
		header.appendChild(createElement("span", "badge-generated", badgeText));
	} else if (option.recommended) {
		header.appendChild(createElement("span", "rec-badge", "Recommended"));
	}

	header.appendChild(createElement("span", "option-num"));
	card.appendChild(header);

	const preview = createElement("div", "preview");
	// The surface hugs the content (the subgrid cell may stretch to a taller sibling),
	// so option pins stay on the same spot of the content across layouts.
	const surface = createElement("div", "preview-surface");
	const content = createElement("div", "preview-content");
	surface.appendChild(content);
	surface.appendChild(createElement("div", "pin-layer"));
	preview.appendChild(surface);
	if (Array.isArray(option.previewBlocks) && option.previewBlocks.length > 0) {
		renderPreviewBlocks(preview, option.previewBlocks, content);
	} else {
		applyPreviewHtml(preview, option.previewHtml, content);
	}
	card.appendChild(preview);
	content.querySelectorAll("a, button:not(.image-expand), input, select, textarea, pre, [contenteditable]").forEach((el) => {
		el.tabIndex = -1;
	});
	initPinSurface(card, surface);

	// Footer: aside (optional), feedback field, pin list
	const footer = createElement("div", "option-footer");

	if (option.aside) {
		const aside = createElement("div", "option-aside");
		// Handle both actual newlines and literal \n sequences
		aside.innerHTML = escapeHtml(option.aside).replace(/\\n/g, "<br>").replace(/\n/g, "<br>");
		footer.appendChild(aside);
	}

	const field = createElement("div", "option-feedback");
	const fieldId = `feedback-${++feedbackFieldCounter}`;
	const fieldHead = createElement("div", "option-feedback-head");
	const fieldLabel = createElement("label", "option-feedback-label", "Feedback");
	fieldLabel.htmlFor = fieldId;
	fieldHead.appendChild(fieldLabel);
	fieldHead.appendChild(createElement("span", "option-feedback-hint", "optional"));
	field.appendChild(fieldHead);

	const input = createElement("textarea", "option-feedback-input");
	input.id = fieldId;
	input.rows = 2;
	input.placeholder = "What would you change about this option?";
	input.value = getFeedback(slideId, option.label)?.note || "";
	input.addEventListener("input", () => {
		ensureFeedback(slideId, option.label).note = input.value;
		pruneFeedback(slideId, option.label);
		autosizeField(input);
		saveSelectionsToStorage();
		markDirty();
	});
	input.addEventListener("keydown", (event) => {
		if (event.key !== "Escape" || event.isComposing) return;
		// Escape leaves the field instead of cancelling the deck; focus returns to the card.
		event.preventDefault();
		event.stopPropagation();
		card.focus();
	});
	// Typing feedback is not a vote for this option.
	field.addEventListener("click", (event) => event.stopPropagation());
	field.appendChild(input);
	footer.appendChild(field);

	const pinList = createElement("ol", "pin-list");
	pinList.setAttribute("aria-label", `Comments on ${option.label}`);
	footer.appendChild(pinList);
	card.appendChild(footer);

	if (option.description) {
		card.setAttribute("title", option.description);
	}

	if (selections[slideId] && selections[slideId] === option.label) {
		card.classList.add("selected");
	}

	renderPins(card);
	return card;
}

let feedbackFieldCounter = 0;

// Re-measures everything whose size depends on the active slide's width.
function refreshActiveSlideLayout() {
	const activeSlide = document.querySelector(".slide.active");
	if (!activeSlide) return;
	equalizeBlockHeights(activeSlide);
	activeSlide.querySelectorAll(".option-feedback-input, .gen-prompt, .final-notes-input").forEach(autosizeField);
	repositionPinPopover();
}

function createGenerateBar(slideId) {
	const bar = createElement("div", "gen-bar");

	const row = createElement("div", "gen-row");
	
	// Generate button with separate count selector
	const genGroup = createElement("div", "gen-group");
	const button = createElement("button", "btn-gen-more");
	button.type = "button";
	button.appendChild(createElement("span", "btn-gen-plus", "+"));
	button.appendChild(document.createTextNode("Generate"));
	
	const countSelect = document.createElement("select");
	countSelect.className = "gen-count";
	countSelect.setAttribute("aria-label", "Number of options to generate");
	[1, 2, 3].forEach((n) => {
		const opt = document.createElement("option");
		opt.value = n;
		opt.textContent = n;
		countSelect.appendChild(opt);
	});
	
	const countLabel = createElement("span", "gen-count-label", "option");
	countSelect.addEventListener("change", () => {
		const count = parseInt(countSelect.value, 10);
		countLabel.textContent = count === 1 ? "option" : "options";
	});
	
	genGroup.appendChild(button);
	genGroup.appendChild(countSelect);
	genGroup.appendChild(countLabel);

	const regenButton = createElement("button", "btn-regen");
	regenButton.type = "button";
	regenButton.innerHTML = "↻ Regenerate all";
	regenButton.title = "Replace all options with fresh alternatives";
	regenButton.addEventListener("click", () => regenerateSlide(regenButton, slideId));

	const input = createElement("textarea", "gen-prompt");
	input.rows = 1;
	input.placeholder = "Optional instructions… (Shift+Enter for a new line)";
	input.setAttribute("aria-label", "Instructions for generated option");
	input.addEventListener("input", () => autosizeField(input));
	input.addEventListener("keydown", (e) => {
		if (isModKey(e) && (e.key === "Enter" || e.key.toLowerCase() === "s")) return;
		if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			button.click();
		}
		e.stopPropagation();
	});

	button.addEventListener("click", () => generateMore(button, slideId, input, countSelect));
	row.appendChild(genGroup);
	row.appendChild(regenButton);
	row.appendChild(input);
	bar.appendChild(row);

	const hint = createElement("span", "gen-hint", "AI generates a distinct additional option");
	hint.setAttribute("role", "status");
	bar.appendChild(hint);
	return bar;
}

// ─── SLIDE RENDERING ─────────────────────────────────────────

function renderSlides() {
	slidesWrap.innerHTML = "";

	slides.forEach((slide, index) => {
		const section = createElement("div", "slide");
		section.dataset.slide = String(index);
		section.dataset.id = slide.id;
		if (index === 0) section.classList.add("active");

		section.appendChild(createElement("span", "slide-step", `${index + 1} / ${slides.length}`));
		const heading = createElement("h2", "", slide.title);
		heading.tabIndex = -1;
		section.appendChild(heading);
		if (slide.context) {
			section.appendChild(createElement("p", "slide-context", slide.context));
		}

		const pick = createElement("div", "slide-pick");
		const pickText = createElement("span", "slide-pick-text");
		pickText.innerHTML = optionHint(slide.options.length);
		pick.appendChild(pickText);
		pick.appendChild(createElement("span", "slide-comment-hint", "Click anywhere on a preview or image to pin a comment."));
		pick.appendChild(createCommentToggle());
		section.appendChild(pick);

		const options = createElement("div", `options ${optionCountClass(slide.options.length, slide.columns)}`);
		options.setAttribute("role", "radiogroup");
		options.setAttribute("aria-label", slide.title);
		slide.options.forEach((option) => {
			const card = createOptionCard(option, slide.id, false);
			options.appendChild(card);
		});
		section.appendChild(options);
		section.appendChild(createGenerateBar(slide.id));
		slidesWrap.appendChild(section);
		equalizeBlockHeights(section);
	});

	slidesWrap.appendChild(createSummarySlide(slides.length));
}

function createSummarySlide(index) {
	const section = createElement("div", "slide");
	section.dataset.slide = String(index);
	section.dataset.id = "summary";
	section.appendChild(createElement("span", "slide-step", "Done"));
	const summaryHeading = createElement("h2", "", "Your Selections");
	summaryHeading.tabIndex = -1;
	section.appendChild(summaryHeading);

	const summaryDesc = createElement("p", "slide-context");
	summaryDesc.id = "summary-desc";
	summaryDesc.setAttribute("aria-live", "polite");
	summaryDesc.textContent = "Select one option per slide.";
	section.appendChild(summaryDesc);

	const summaryGrid = createElement("div", "summary-grid");
	summaryGrid.id = "summary-grid";
	section.appendChild(summaryGrid);

	// Final instructions textarea
	const finalNotesContainer = createElement("div", "final-notes");
	const finalNotesLabel = createElement("label", "final-notes-label", "Additional instructions (optional)");
	finalNotesLabel.setAttribute("for", "final-notes-input");
	const finalNotesInput = createElement("textarea", "final-notes-input");
	finalNotesInput.id = "final-notes-input";
	finalNotesInput.placeholder = "Add any final notes or instructions for implementation...";
	finalNotesInput.rows = 2;
	finalNotesInput.addEventListener("input", (e) => {
		finalNotes = e.target.value.trim();
		autosizeField(finalNotesInput);
		saveSelectionsToStorage();
		markDirty();
	});
	finalNotesContainer.appendChild(finalNotesLabel);
	finalNotesContainer.appendChild(finalNotesInput);
	section.appendChild(finalNotesContainer);

	const submitButton = createElement("button", "btn-generate", "Submit Selections");
	submitButton.type = "button";
	submitButton.id = "btn-generate";
	submitButton.disabled = true;
	submitButton.addEventListener("click", () => {
		submitDeck().catch(() => {});
	});
	section.appendChild(submitButton);

	return section;
}

// ─── SUMMARY ─────────────────────────────────────────────────

function findOption(slideId, label) {
	const slide = slides.find((entry) => entry.id === slideId);
	if (!slide) return null;
	return slide.options.find((entry) => entry.label === label) || null;
}

function createSummaryCard(slide) {
	const card = createElement("div", "summary-card");
	card.appendChild(createElement("div", "summary-label", slide.title));

	const selectedLabel = selections[slide.id];
	card.appendChild(createElement("div", "summary-value", selectedLabel || "-"));

	if (selectedLabel) {
		const selectedOption = findOption(slide.id, selectedLabel);
		if (selectedOption) {
			const previewShell = createElement("div", "summary-preview");

			if (Array.isArray(selectedOption.previewBlocks) && selectedOption.previewBlocks.length > 0) {
				const first = selectedOption.previewBlocks[0];
				if (first.type === "code") {
					const codeSnippet = createElement("div", "summary-code-snippet");
					const pre = document.createElement("pre");
					const codeEl = document.createElement("code");
					codeEl.className = `language-${first.lang}`;
					const lines = first.code.split("\n").slice(0, 3).join("\n");
					codeEl.textContent = lines;
					pre.appendChild(codeEl);
					codeSnippet.appendChild(pre);
					previewShell.appendChild(codeSnippet);
					if (window.Prism?.highlightElement) {
						window.Prism.highlightElement(codeEl);
					} else {
						loadPrism().then((prism) => prism.highlightElement(codeEl)).catch(() => {});
					}
				} else if (first.type === "image") {
					const img = document.createElement("img");
					img.src = first.src;
					img.alt = first.alt;
					img.style.width = "100%";
					img.style.height = "80px";
					img.style.objectFit = "cover";
					img.style.display = "block";
					img.style.borderRadius = "6px";
					previewShell.appendChild(img);
				} else if (first.type === "mermaid") {
					const mermaidWrap = createElement("div", "summary-mermaid");
					mermaidWrap.style.height = "80px";
					mermaidWrap.style.overflow = "hidden";
					previewShell.appendChild(mermaidWrap);
					whenMermaidReady(() => renderMermaidBlock(mermaidWrap, first.content, first.theme));
				} else if (first.type === "html") {
					const preview = createElement("div", "preview");
					preview.innerHTML = first.content;
					previewShell.appendChild(preview);
				}
			} else {
				const preview = createElement("div", "preview");
				applyPreviewHtml(preview, selectedOption.previewHtml);
				previewShell.appendChild(preview);
			}

			card.appendChild(previewShell);

			if (selectedOption.aside) {
				const aside = createElement("div", "summary-aside");
				const text = selectedOption.aside.length > 120
					? selectedOption.aside.slice(0, 120).trimEnd() + "..."
					: selectedOption.aside;
				aside.innerHTML = escapeHtml(text).replace(/\\n/g, "<br>").replace(/\n/g, "<br>");
				card.appendChild(aside);
			}
		}
	}

	const slideFeedback = buildFeedbackPayload()[slide.id] || {};
	const selectedFeedback = selectedLabel ? slideFeedback[selectedLabel] : null;
	if (selectedFeedback) {
		const readout = createElement("div", "summary-notes");
		readout.appendChild(createElement("span", "summary-notes-label", "Your feedback"));
		if (selectedFeedback.note) readout.appendChild(createElement("div", "summary-notes-body", selectedFeedback.note));
		if (selectedFeedback.pins.length > 0) {
			const list = createElement("ol", "summary-pins");
			selectedFeedback.pins.forEach((pin) => list.appendChild(createElement("li", "", pin.text)));
			readout.appendChild(list);
		}
		card.appendChild(readout);
	}
	const others = Object.keys(slideFeedback).filter((label) => label !== selectedLabel);
	if (others.length > 0) {
		card.appendChild(createElement("div", "summary-others", `Also sending feedback on ${others.join(", ")}`));
	}

	return card;
}

function updateSummary() {
	const summaryGrid = document.getElementById("summary-grid");
	const summaryDesc = document.getElementById("summary-desc");
	const submitButton = document.getElementById("btn-generate");
	if (!summaryGrid || !summaryDesc || !submitButton) return;

	summaryGrid.innerHTML = "";
	slides.forEach((slide) => {
		summaryGrid.appendChild(createSummaryCard(slide));
	});

	const missing = slides.filter((slide) => !selections[slide.id]).map((slide) => slide.title);
	const allDone = missing.length === 0;

	summaryDesc.textContent = allDone
		? "All decisions made. Ready to submit."
		: `Still need: ${missing.join(", ")}.`;

	submitButton.disabled = !allDone || isClosed || isSubmitting;
}
