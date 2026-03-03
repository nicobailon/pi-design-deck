// ─── MERMAID RENDERING ───────────────────────────────────────

let mermaidReady = !!window.__mermaid;
const mermaidQueue = [];

if (!mermaidReady) {
	window.addEventListener("mermaid-ready", () => {
		mermaidReady = true;
		while (mermaidQueue.length > 0) {
			mermaidQueue.shift()();
		}
	});
}

function whenMermaidReady(fn) {
	if (mermaidReady) {
		fn();
	} else {
		mermaidQueue.push(fn);
	}
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

function renderCodeBlock(container, code, lang) {
	const pre = document.createElement("pre");
	pre.tabIndex = -1;
	const codeEl = document.createElement("code");
	codeEl.className = `language-${lang}`;
	codeEl.textContent = code;
	pre.appendChild(codeEl);
	container.appendChild(pre);

	if (typeof Prism !== "undefined" && Prism.highlightElement) {
		Prism.highlightElement(codeEl);
	}
}

// ─── PREVIEW BLOCKS ──────────────────────────────────────────

function renderPreviewBlocks(preview, blocks) {
	preview.classList.add("preview-blocks");
	for (const block of blocks) {
		if (block.type === "html") {
			const wrapper = createElement("div", "preview-block preview-block-html");
			wrapper.innerHTML = block.content;
			preview.appendChild(wrapper);
		} else if (block.type === "mermaid") {
			const wrapper = createElement("div", "preview-block preview-block-mermaid");
			wrapper.tabIndex = -1;
			preview.appendChild(wrapper);
			whenMermaidReady(() => renderMermaidBlock(wrapper, block.content, block.theme));
		} else if (block.type === "code") {
			const wrapper = createElement("div", "preview-block preview-block-code");
			renderCodeBlock(wrapper, block.code, block.lang);
			preview.appendChild(wrapper);
		} else if (block.type === "image") {
			const wrapper = createElement("div", "preview-block preview-block-image");
			const img = document.createElement("img");
			img.src = block.src;
			img.alt = block.alt;
			img.loading = "lazy";
			img.onload = () => { const s = wrapper.closest(".slide"); if (s) equalizeBlockHeights(s); };
			wrapper.appendChild(img);
			if (block.caption) {
				const cap = createElement("div", "preview-block-caption", block.caption);
				wrapper.appendChild(cap);
			}
			preview.appendChild(wrapper);
		}
	}
}

function applyPreviewHtml(preview, previewHtml) {
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
		preview.innerHTML = first.innerHTML;
		return;
	}

	preview.innerHTML = previewHtml;
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

function optionHint(count, multiSelect) {
	const max = Math.min(9, Math.max(1, count));
	const parts = [];
	for (let i = 1; i <= max; i += 1) {
		parts.push(`<kbd>${i}</kbd>`);
	}
	if (multiSelect) {
		return `Choose any (or select all) - press ${parts.join(" ")} or click to toggle`;
	}
	return `Choose one - press ${parts.join(" ")} or click`;
}

function createOptionCard(option, slideId, generatedBy) {
	const slide = slides.find((s) => s.id === slideId);
	const isMulti = slide && slide.multiSelect;
	const card = createElement("div", "option");
	card.setAttribute("role", isMulti ? "checkbox" : "radio");
	card.setAttribute("aria-checked", "false");
	card.tabIndex = 0;
	if (generatedBy !== false) {
		card.classList.add("option-generated");
	}
	if (isMulti) {
		card.classList.add("option-multi");
	}
	card.dataset.value = option.label;
	card.addEventListener("click", () => isMulti ? toggleMultiOption(card) : selectOption(card));

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
	if (Array.isArray(option.previewBlocks) && option.previewBlocks.length > 0) {
		renderPreviewBlocks(preview, option.previewBlocks);
	} else {
		applyPreviewHtml(preview, option.previewHtml);
	}
	card.appendChild(preview);
	preview.querySelectorAll("a, button, input, select, textarea, pre, [contenteditable]").forEach((el) => {
		el.tabIndex = -1;
	});

	// Footer contains aside (optional) + notes input
	const footer = createElement("div", "option-footer");

	if (option.aside) {
		const aside = createElement("div", "option-aside");
		// Handle both actual newlines and literal \n sequences
		aside.innerHTML = escapeHtml(option.aside).replace(/\\n/g, "<br>").replace(/\n/g, "<br>");
		footer.appendChild(aside);
	}

	// Notes input for user instructions
	const notesContainer = createElement("div", "option-notes");
	const notesLabel = createElement("label", "option-notes-label", "Your notes (optional)");
	const notesInput = createElement("textarea", "option-notes-input");
	notesInput.placeholder = "Add notes...";
	notesInput.rows = 1;
	notesInput.dataset.slideId = slideId;
	notesInput.dataset.optionLabel = option.label;
	
	// Restore saved notes if this option was previously selected with notes
	if (optionNotes[slideId]?.label === option.label && optionNotes[slideId]?.notes) {
		notesInput.value = optionNotes[slideId].notes;
	}
	
	notesInput.addEventListener("input", (e) => {
		const value = e.target.value.trim();
		if (value) {
			optionNotes[slideId] = { label: option.label, notes: value };
		} else if (optionNotes[slideId]?.label === option.label) {
			delete optionNotes[slideId];
		}
		saveSelectionsToStorage();
		markDirty();
	});
	
	// Prevent click from bubbling to card (which would select it)
	notesInput.addEventListener("click", (e) => e.stopPropagation());
	
	notesContainer.appendChild(notesLabel);
	notesContainer.appendChild(notesInput);
	footer.appendChild(notesContainer);
	card.appendChild(footer);

	if (option.description) {
		card.setAttribute("title", option.description);
	}

	if (selections[slideId] && selections[slideId] === option.label) {
		card.classList.add("selected");
	}

	return card;
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

	const input = document.createElement("input");
	input.type = "text";
	input.className = "gen-prompt";
	input.placeholder = "Optional instructions...";
	input.setAttribute("aria-label", "Instructions for generated option");
	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
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

		const pick = createElement("p", "slide-pick");
		pick.innerHTML = optionHint(slide.options.length, slide.multiSelect);
		section.appendChild(pick);

		if (slide.multiSelect) {
			const selectAllBar = createElement("div", "select-all-bar");
			const selectAllBtn = createElement("button", "btn-select-all", "⚡ Select All");
			selectAllBtn.type = "button";
			selectAllBtn.dataset.slideId = slide.id;
			selectAllBtn.addEventListener("click", () => toggleSelectAll(slide.id));
			selectAllBar.appendChild(selectAllBtn);
			const selectAllHint = createElement("span", "select-all-hint", "Pick some or all — they'll be composed together");
			selectAllBar.appendChild(selectAllHint);
			section.appendChild(selectAllBar);
		}

		const options = createElement("div", `options ${optionCountClass(slide.options.length, slide.columns)}`);
		options.setAttribute("role", slide.multiSelect ? "group" : "radiogroup");
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

	const rawSelection = selections[slide.id];
	const selectedLabel = Array.isArray(rawSelection) ? rawSelection.join(", ") : rawSelection;
	const isMultiSelected = Array.isArray(rawSelection) && rawSelection.length > 0;
	
	if (isMultiSelected) {
		const valueEl = createElement("div", "summary-value summary-value-multi");
		rawSelection.forEach((label) => {
			const tag = createElement("span", "summary-tag", label);
			valueEl.appendChild(tag);
		});
		card.appendChild(valueEl);
	} else {
		card.appendChild(createElement("div", "summary-value", selectedLabel || "-"));
	}

	const firstSelectedLabel = isMultiSelected ? rawSelection[0] : selectedLabel;
	if (firstSelectedLabel) {
		const selectedOption = findOption(slide.id, firstSelectedLabel);
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
					if (typeof Prism !== "undefined" && Prism.highlightElement) {
						Prism.highlightElement(codeEl);
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

		// Show user notes if present
		const noteData = optionNotes[slide.id];
		const noteMatches = noteData && (noteData.label === firstSelectedLabel || (isMultiSelected && rawSelection.includes(noteData.label)));
		if (noteMatches && noteData.notes) {
			const notesDisplay = createElement("div", "summary-notes");
			notesDisplay.innerHTML = `<span class="summary-notes-label">Your notes:</span> ${escapeHtml(noteData.notes)}`;
			card.appendChild(notesDisplay);
		}
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

	const missing = slides.filter((slide) => {
		const sel = selections[slide.id];
		if (!sel) return true;
		if (Array.isArray(sel) && sel.length === 0) return true;
		return false;
	}).map((slide) => slide.title);
	const allDone = missing.length === 0;

	summaryDesc.textContent = allDone
		? "All decisions made. Ready to submit."
		: `Still need: ${missing.join(", ")}.`;

	submitButton.disabled = !allDone || isClosed || isSubmitting;
}
