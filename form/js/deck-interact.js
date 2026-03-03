// ─── SELECTION ───────────────────────────────────────────────

function applySavedSelections(savedSelections, savedNotes) {
	if (!savedSelections || typeof savedSelections !== "object") return;
	isRestoringSelections = true;
	try {
		for (const [slideId, label] of Object.entries(savedSelections)) {
			const slideEl = document.querySelector(`.slide[data-id="${CSS.escape(slideId)}"]`);
			if (!slideEl) continue;
			
			if (Array.isArray(label)) {
				// Multi-select restoration
				selections[slideId] = [...label];
				for (const card of slideEl.querySelectorAll(".option")) {
					if (label.includes(card.dataset.value)) {
						card.classList.add("selected");
						card.setAttribute("aria-checked", "true");
					}
				}
				syncSelectAllButton(slideId);
			} else if (typeof label === "string") {
				for (const card of slideEl.querySelectorAll(".option")) {
					if (card.dataset.value === label) {
						selectOption(card);
						break;
					}
				}
			}
		}
	} finally {
		isRestoringSelections = false;
	}
	// Restore notes
	if (savedNotes && typeof savedNotes === "object") {
		for (const [slideId, noteData] of Object.entries(savedNotes)) {
			if (noteData && typeof noteData === "object" && noteData.label && noteData.notes) {
				optionNotes[slideId] = noteData;
				// Find and populate the textarea
				const input = document.querySelector(`.option-notes-input[data-slide-id="${CSS.escape(slideId)}"][data-option-label="${CSS.escape(noteData.label)}"]`);
				if (input) input.value = noteData.notes;
			}
		}
	}
}

function restoreSelections() {
	const serverSaved = deckData.savedSelections;
	const hasServerSavedSelections = serverSaved && typeof serverSaved === "object" && Object.keys(serverSaved).length > 0;
	const hasServerSavedNotes = deckData.savedNotes && typeof deckData.savedNotes === "object" && Object.keys(deckData.savedNotes).length > 0;
	const hasServerFinalNotes = typeof deckData.savedFinalNotes === "string" && deckData.savedFinalNotes.trim() !== "";
	if (hasServerSavedSelections || hasServerSavedNotes || hasServerFinalNotes) {
		applySavedSelections(hasServerSavedSelections ? serverSaved : null, deckData.savedNotes || null);
		if (deckData.savedFinalNotes) {
			finalNotes = deckData.savedFinalNotes;
			const input = document.getElementById("final-notes-input");
			if (input) input.value = deckData.savedFinalNotes;
		}
		return;
	}
	const stored = loadSelectionsFromStorage();
	if (stored) {
		applySavedSelections(stored.selections || stored, stored.optionNotes);
		// Restore final notes if present
		if (stored.finalNotes) {
			finalNotes = stored.finalNotes;
			const input = document.getElementById("final-notes-input");
			if (input) input.value = stored.finalNotes;
		}
	}
}

function applySelectionClasses(slideElement, selectedElement) {
	slideElement.querySelectorAll(".option").forEach((optionEl) => {
		optionEl.classList.remove("selected");
		optionEl.setAttribute("aria-checked", "false");
	});
	selectedElement.classList.add("selected");
	selectedElement.setAttribute("aria-checked", "true");
}

function selectOption(optionElement) {
	if (isClosed) return;
	const slideElement = optionElement.closest(".slide");
	if (!slideElement) return;
	const slideId = slideElement.dataset.id;
	if (!slideId || slideId === "summary") return;
	const nextValue = optionElement.dataset.value || "";
	if (selections[slideId] === nextValue) return;

	applySelectionClasses(slideElement, optionElement);
	selections[slideId] = nextValue;
	if (!isRestoringSelections) {
		saveSelectionsToStorage();
		markDirty();
	}
}

function toggleMultiOption(optionElement) {
	if (isClosed) return;
	const slideElement = optionElement.closest(".slide");
	if (!slideElement) return;
	const slideId = slideElement.dataset.id;
	if (!slideId || slideId === "summary") return;
	const value = optionElement.dataset.value || "";

	// Ensure selections[slideId] is an array for multi-select
	if (!Array.isArray(selections[slideId])) {
		selections[slideId] = [];
	}
	const arr = selections[slideId];
	const idx = arr.indexOf(value);
	if (idx >= 0) {
		arr.splice(idx, 1);
		optionElement.classList.remove("selected");
		optionElement.setAttribute("aria-checked", "false");
	} else {
		arr.push(value);
		optionElement.classList.add("selected");
		optionElement.setAttribute("aria-checked", "true");
	}

	// Update select-all button state
	syncSelectAllButton(slideId);

	if (!isRestoringSelections) {
		saveSelectionsToStorage();
		markDirty();
	}
}

function toggleSelectAll(slideId) {
	if (isClosed) return;
	const slideElement = document.querySelector(`.slide[data-id="${CSS.escape(slideId)}"]`);
	if (!slideElement) return;
	const slide = slides.find((s) => s.id === slideId);
	if (!slide) return;

	const allLabels = slide.options.map((o) => o.label);
	const currentArr = Array.isArray(selections[slideId]) ? selections[slideId] : [];
	const allSelected = allLabels.length > 0 && allLabels.every((l) => currentArr.includes(l));

	if (allSelected) {
		// Deselect all
		selections[slideId] = [];
		slideElement.querySelectorAll(".option").forEach((card) => {
			card.classList.remove("selected");
			card.setAttribute("aria-checked", "false");
		});
	} else {
		// Select all
		selections[slideId] = [...allLabels];
		slideElement.querySelectorAll(".option").forEach((card) => {
			card.classList.add("selected");
			card.setAttribute("aria-checked", "true");
		});
	}

	syncSelectAllButton(slideId);
	saveSelectionsToStorage();
	markDirty();
}

function syncSelectAllButton(slideId) {
	const btn = document.querySelector(`.btn-select-all[data-slide-id="${CSS.escape(slideId)}"]`);
	if (!btn) return;
	const slide = slides.find((s) => s.id === slideId);
	if (!slide) return;
	const allLabels = slide.options.map((o) => o.label);
	const currentArr = Array.isArray(selections[slideId]) ? selections[slideId] : [];
	const allSelected = allLabels.length > 0 && allLabels.every((l) => currentArr.includes(l));
	btn.textContent = allSelected ? "✓ All Selected" : "⚡ Select All";
	btn.classList.toggle("all-selected", allSelected);
}

// ─── NAVIGATION ──────────────────────────────────────────────

function showSlide(index) {
	if (index < 0 || index >= totalSlides) return;
	current = index;

	document.querySelectorAll(".slide").forEach((slideEl, slideIndex) => {
		slideEl.classList.toggle("active", slideIndex === index);
	});

	if (progressFill) {
		progressFill.style.width = `${((index + 1) / totalSlides) * 100}%`;
	}

	if (btnBack) {
		btnBack.disabled = index === 0 || isClosed;
	}

	if (btnNext) {
		if (index === totalSlides - 1) {
			btnNext.textContent = "Done";
			btnNext.disabled = true;
		} else {
			btnNext.textContent = "Next \u2192";
			btnNext.disabled = isClosed;
		}
	}

	if (index === totalSlides - 1) {
		updateSummary();
	}

	const activeSlide = document.querySelector(`.slide[data-slide="${index}"]`);
	if (activeSlide) {
		equalizeBlockHeights(activeSlide);
		const heading = activeSlide.querySelector("h2");
		if (heading) heading.focus({ preventScroll: true });
	}
}

function moveFocusInRadiogroup(direction) {
	const activeSlide = document.querySelector(".slide.active");
	if (!activeSlide || activeSlide.dataset.id === "summary") return false;

	const options = Array.from(activeSlide.querySelectorAll(".option"));
	if (options.length === 0) return false;

	const currentFocus = document.activeElement;
	const currentIndex = options.indexOf(currentFocus);
	if (currentIndex === -1) return false;

	let nextIndex = currentIndex + direction;
	if (nextIndex < 0) nextIndex = options.length - 1;
	if (nextIndex >= options.length) nextIndex = 0;

	options[nextIndex].focus();
	return true;
}

function navigate(direction) {
	if (isClosed) return;
	const next = current + direction;
	if (next < 0 || next >= totalSlides) return;
	showSlide(next);
}

// ─── KEYBOARD HANDLING ───────────────────────────────────────

function handleKeydown(event) {
	if (isClosed) return;

	if (event.key === "ArrowDown" || event.key === "ArrowRight") {
		const isInRadiogroup = document.activeElement && document.activeElement.classList.contains("option");
		if (isInRadiogroup) {
			event.preventDefault();
			moveFocusInRadiogroup(1);
			return;
		}
		event.preventDefault();
		navigate(1);
		return;
	}

	if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
		const isInRadiogroup = document.activeElement && document.activeElement.classList.contains("option");
		if (isInRadiogroup) {
			event.preventDefault();
			moveFocusInRadiogroup(-1);
			return;
		}
		event.preventDefault();
		navigate(-1);
		return;
	}

	if (event.key === " ") {
		const focused = document.activeElement;
		if (focused && focused.classList.contains("option")) {
			event.preventDefault();
			if (focused.classList.contains("option-multi")) {
				toggleMultiOption(focused);
			} else {
				selectOption(focused);
			}
			return;
		}
	}

	if (event.key === "Enter") {
		const focused = document.activeElement;
		if (focused && focused.classList.contains("option")) {
			event.preventDefault();
			if (focused.classList.contains("option-multi")) {
				toggleMultiOption(focused);
			} else {
				selectOption(focused);
			}
			return;
		}
		if (focused && focused.tagName === "BUTTON") {
			return;
		}
		event.preventDefault();
		if (current === totalSlides - 1) {
			submitDeck().catch(() => {});
		} else {
			navigate(1);
		}
		return;
	}

	if (event.key === "Escape") {
		event.preventDefault();
		handleEscape();
		return;
	}

	const num = Number.parseInt(event.key, 10);
	if (Number.isNaN(num) || num < 1 || num > 9) return;

	const activeSlide = document.querySelector(".slide.active");
	if (!activeSlide || activeSlide.dataset.id === "summary") return;

	const options = activeSlide.querySelectorAll(".option");
	const target = options[num - 1];
	if (target) {
		event.preventDefault();
		if (target.classList.contains("option-multi")) {
			toggleMultiOption(target);
		} else {
			selectOption(target);
		}
	}
}

// ─── MODEL BAR ───────────────────────────────────────────────

async function fetchModels() {
	try {
		const res = await fetch(`/models?session=${encodeURIComponent(sessionToken)}`);
		if (!res.ok) return null;
		return await res.json();
	} catch {
		return null;
	}
}

function modelSupportsXhigh(id) {
	return id.includes("gpt-5.2") || id.includes("gpt-5.3") ||
		id.includes("opus-4-6") || id.includes("opus-4.6");
}

function renderThinkingPills(container, modelId) {
	container.innerHTML = "";
	const levels = ["off", "low", "medium", "high"];
	if (modelSupportsXhigh(modelId)) levels.push("xhigh");
	const labels = { off: "off", low: "low", medium: "med", high: "high", xhigh: "xhigh" };
	for (const level of levels) {
		const pill = document.createElement("button");
		pill.type = "button";
		pill.className = "model-pill" + (selectedThinking === level ? " active" : "");
		pill.dataset.level = level;
		pill.textContent = labels[level] || level;
		pill.addEventListener("click", () => {
			selectedThinking = level;
			container.querySelectorAll(".model-pill").forEach((p) => {
				p.classList.toggle("active", p.dataset.level === level);
			});
		});
		container.appendChild(pill);
	}
}

function renderModelListItems(container, models, currentModelId, onSelect) {
	container.innerHTML = "";
	container.style.display = models.length ? "" : "none";
	for (const m of models) {
		const item = document.createElement("button");
		item.type = "button";
		item.className = "model-list-item";
		item.setAttribute("role", "option");
		const value = `${m.provider}/${m.id}`;
		item.dataset.value = value;
		item.appendChild(document.createTextNode(m.name || m.id));
		if (value === currentModelId) {
			item.appendChild(createElement("span", "model-tag", "current"));
		}
		if (value === selectedModel) {
			item.classList.add("selected");
			item.setAttribute("aria-selected", "true");
		}
		item.addEventListener("click", () => onSelect(value));
		container.appendChild(item);
	}
}

function initModelBar(modelsData) {
	if (isClosed) return;
	if (!modelsData || !Array.isArray(modelsData.available) || modelsData.available.length < 2) return;

	const bar = createElement("div", "model-bar");
	const top = createElement("div", "model-bar-top");
	const labelGroup = createElement("div", "model-bar-label-group");
	labelGroup.appendChild(createElement("span", "model-bar-label", "Generate with"));
	top.appendChild(labelGroup);

	const defaultLabel = createElement("label", "model-default-label");
	const defaultCheck = document.createElement("input");
	defaultCheck.type = "checkbox";
	defaultCheck.className = "model-default-check";
	defaultLabel.appendChild(defaultCheck);
	defaultLabel.append(" Default");
	defaultLabel.title = "Save as default for future decks";
	top.appendChild(defaultLabel);
	bar.appendChild(top);

	const byProvider = {};
	for (const m of modelsData.available) {
		(byProvider[m.provider] ??= []).push(m);
	}

	const pills = createElement("div", "model-pills");
	const currentPill = document.createElement("button");
	currentPill.type = "button";
	currentPill.className = "model-pill active";
	currentPill.dataset.provider = "";
	currentPill.textContent = `Current (${modelsData.current ? modelsData.current.split("/").pop() : "current"})`;
	pills.appendChild(currentPill);
	for (const provider of Object.keys(byProvider).sort()) {
		const pill = document.createElement("button");
		pill.type = "button";
		pill.className = "model-pill";
		pill.dataset.provider = provider;
		pill.textContent = provider;
		pills.appendChild(pill);
	}
	bar.appendChild(pills);

	const list = createElement("div", "model-list");
	list.setAttribute("role", "listbox");
	list.setAttribute("aria-label", "Available models");
	list.style.display = "none";
	bar.appendChild(list);

	const selectedLabelEl = createElement("span", "model-selected");
	selectedLabelEl.style.display = "none";
	labelGroup.appendChild(selectedLabelEl);

	const thinkingRow = createElement("div", "thinking-row");
	thinkingRow.style.display = "none";
	thinkingRow.appendChild(createElement("span", "thinking-label", "Thinking"));
	const thinkingPills = createElement("div", "thinking-pills");
	thinkingRow.appendChild(thinkingPills);
	bar.appendChild(thinkingRow);

	selectedThinking = modelsData.currentThinking || "off";
	let activeProvider = "";
	const currentModelId = modelsData.current || "";

	function getSelectedModelInfo() {
		if (!selectedModel) {
			return { reasoning: modelsData.currentModelReasoning, id: currentModelId.split("/")[1] || "" };
		}
		const found = modelsData.available.find((m) => `${m.provider}/${m.id}` === selectedModel);
		return found ? { reasoning: found.reasoning, id: found.id } : null;
	}

	function syncThinkingRow() {
		if (selectedModel) { thinkingRow.style.display = "none"; return; }
		const info = getSelectedModelInfo();
		if (!info || !info.reasoning) { thinkingRow.style.display = "none"; return; }
		thinkingRow.style.display = "";
		renderThinkingPills(thinkingPills, info.id);
	}

	function syncSelectedLabel() {
		if (!selectedModel) { selectedLabelEl.style.display = "none"; return; }
		const model = modelsData.available.find((m) => `${m.provider}/${m.id}` === selectedModel);
		selectedLabelEl.textContent = model ? (model.name || model.id) : selectedModel;
		selectedLabelEl.style.display = "";
	}

	function syncDefaultCheck() {
		const effectiveModel = selectedModel || modelsData.current;
		defaultCheck.checked = modelsData.defaultModel != null && effectiveModel === modelsData.defaultModel;
	}

	function activateProvider(provider) {
		activeProvider = provider;
		pills.querySelectorAll(".model-pill").forEach((p) => {
			p.classList.toggle("active", p.dataset.provider === provider);
		});
		if (!provider) {
			selectedModel = "";
			syncDefaultCheck();
			list.style.display = "none";
			list.innerHTML = "";
			syncSelectedLabel();
			syncThinkingRow();
			return;
		}
		renderModelListItems(list, byProvider[provider] || [], currentModelId, (value) => {
			selectedModel = value;
			syncDefaultCheck();
			list.style.display = "none";
			syncSelectedLabel();
			syncThinkingRow();
		});
	}

	pills.addEventListener("click", (e) => {
		const pill = e.target.closest(".model-pill");
		if (pill) activateProvider(pill.dataset.provider);
	});

	defaultCheck.addEventListener("change", async () => {
		// Use selectedModel, or fall back to current model when on "Current" pill
		const modelToSave = selectedModel || modelsData.current;
		if (defaultCheck.checked && !modelToSave) { defaultCheck.checked = false; return; }
		const model = defaultCheck.checked ? modelToSave : null;
		try {
			await postJson("/save-model-default", { token: sessionToken, model });
			modelsData.defaultModel = model;
		} catch (err) {
			console.error("Failed to save default model:", err);
			// Revert checkbox to match actual state
			syncDefaultCheck();
		}
	});

	if (modelsData.defaultModel) {
		const parts = modelsData.defaultModel.split("/");
		if (parts.length >= 2 && byProvider[parts[0]]) {
			selectedModel = modelsData.defaultModel;
			activateProvider(parts[0]);
			list.style.display = "none";
			syncSelectedLabel();
		}
	}
	syncDefaultCheck();
	syncThinkingRow();

	const header = document.querySelector(".deck-header");
	if (header) header.after(bar);
	hasModelBar = true;
}
