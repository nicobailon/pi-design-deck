// ─── STATE & CONFIGURATION ───────────────────────────────────

const deckData = window.__DECK_DATA__ || {};
const config =
	deckData && typeof deckData === "object" && deckData.config && typeof deckData.config === "object"
		? deckData.config
		: { slides: [] };

const sessionToken = typeof deckData.sessionToken === "string" ? deckData.sessionToken : "";

const slides = Array.isArray(config.slides)
	? config.slides.map((slide) => ({
			...slide,
			options: Array.isArray(slide.options) ? [...slide.options] : [],
		}))
	: [];

const totalSlides = slides.length + 1;
let current = 0;
let events = null;
let heartbeatTimer = null;
let isClosed = false;
let isSubmitting = false;
let isDirty = false;
let lastSavedLabel = "";
let isRestoringSelections = false;

const selections = {};
// slideId → option label → { note, pins: [{ id, target, blockIndex, x, y, text }] }
const feedback = {};
let finalNotes = "";
let commentMode = false;
const pendingGenerate = new Map();
let selectedModel = "";
let selectedThinking = "off";
let hasModelBar = false;

// DOM references
const progressFill = document.getElementById("progress-fill");
const slidesWrap = document.getElementById("slides-wrap");
const btnBack = document.getElementById("btn-back");
const btnNext = document.getElementById("btn-next");
const btnSave = document.getElementById("btn-save");
const saveStatus = document.getElementById("save-status");

// ─── UTILITIES ───────────────────────────────────────────────

function createElement(tag, className, text) {
	const el = document.createElement(tag);
	if (className) el.className = className;
	if (text !== undefined) el.textContent = text;
	return el;
}

function escapeHtml(str) {
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;

function isModKey(event) {
	return isMac ? event.metaKey : event.ctrlKey;
}

// Document-level shortcuts must never fire while the user is typing or composing (IME),
// or while the image viewer dialog owns the keyboard.
function isTypingEvent(event) {
	if (event.isComposing || event.keyCode === 229) return true;
	const target = event.target;
	if (!(target instanceof Element)) return false;
	return !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
}

function isInsideDialog(event) {
	return event.target instanceof Element && !!event.target.closest("dialog");
}

function autosizeField(field) {
	if (CSS.supports("field-sizing", "content")) return;
	field.style.height = "auto";
	field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
}

// ─── FEEDBACK STATE ──────────────────────────────────────────

function getFeedback(slideId, label) {
	return feedback[slideId]?.[label] || null;
}

function ensureFeedback(slideId, label) {
	const bySlide = (feedback[slideId] ??= {});
	return (bySlide[label] ??= { note: "", pins: [] });
}

function pruneFeedback(slideId, label) {
	const entry = getFeedback(slideId, label);
	if (!entry || entry.note.trim() || entry.pins.length > 0) return;
	delete feedback[slideId][label];
	if (Object.keys(feedback[slideId]).length === 0) delete feedback[slideId];
}

// Wire shape for /submit and /save: every option with feedback, selected or not.
function buildFeedbackPayload() {
	const out = {};
	for (const [slideId, byLabel] of Object.entries(feedback)) {
		for (const [label, entry] of Object.entries(byLabel)) {
			const note = entry.note.trim();
			const pins = entry.pins
				.filter((pin) => pin.text.trim())
				.map((pin) => ({ id: pin.id, target: pin.target, blockIndex: pin.blockIndex, x: pin.x, y: pin.y, text: pin.text.trim() }));
			if (!note && pins.length === 0) continue;
			(out[slideId] ??= {})[label] = { note, pins };
		}
	}
	return out;
}

function hasAnyInput() {
	return Object.keys(selections).length > 0 || Object.keys(buildFeedbackPayload()).length > 0 || !!finalNotes;
}

function equalizeBlockHeights(container) {
	const types = ["mermaid", "code", "html", "image"];
	for (const type of types) {
		const blocks = container.querySelectorAll(`.preview-block-${type}`);
		if (blocks.length < 2) continue;
		blocks.forEach((b) => { b.style.height = ""; });
		let maxH = 0;
		blocks.forEach((b) => { maxH = Math.max(maxH, b.offsetHeight); });
		if (maxH > 0) blocks.forEach((b) => { b.style.height = maxH + "px"; });
	}
}

function setMetaLabel() {
	const deckTitle = document.getElementById("deck-title");
	if (!deckTitle) return;
	const title = typeof config.title === "string" && config.title ? config.title : "Design Decisions";
	const cwd = typeof deckData.cwd === "string" ? deckData.cwd : "";
	const gitBranch = typeof deckData.gitBranch === "string" ? deckData.gitBranch : "";
	if (cwd) {
		deckTitle.textContent = `${title} - ${cwd}${gitBranch ? ` (${gitBranch})` : ""}`;
		return;
	}
	deckTitle.textContent = title;
}

function formatSavedTimestamp(value) {
	try {
		return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
	} catch {
		return "";
	}
}

function updateSaveStatus() {
	if (saveStatus) {
		if (isDirty) {
			saveStatus.textContent = "Unsaved changes";
			saveStatus.classList.add("dirty");
			saveStatus.classList.remove("saved");
		} else if (lastSavedLabel) {
			saveStatus.textContent = `Saved ${lastSavedLabel}`;
			saveStatus.classList.add("saved");
			saveStatus.classList.remove("dirty");
		} else {
			saveStatus.textContent = "No unsaved changes";
			saveStatus.classList.remove("dirty", "saved");
		}
	}
	if (btnSave) {
		btnSave.disabled = isClosed;
		btnSave.classList.toggle("dirty", isDirty);
	}
}

function markDirty() {
	if (isClosed) return;
	isDirty = true;
	updateSaveStatus();
}

function markSaved(savedAt) {
	isDirty = false;
	lastSavedLabel = formatSavedTimestamp(savedAt || new Date().toISOString());
	updateSaveStatus();
}

// ─── THEME SYSTEM ────────────────────────────────────────────

const themeConfig = deckData && typeof deckData === "object" && deckData.theme && typeof deckData.theme === "object" ? deckData.theme : {};
const themeMode = typeof themeConfig.mode === "string" ? themeConfig.mode : "dark";
const themeToggleHotkey = typeof themeConfig.toggleHotkey === "string" ? themeConfig.toggleHotkey : "";
const THEME_OVERRIDE_KEY = "pi-deck-theme-override";

function getSystemTheme() {
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getStoredThemeOverride() {
	try {
		const value = localStorage.getItem(THEME_OVERRIDE_KEY);
		return value === "light" || value === "dark" ? value : null;
	} catch { return null; }
}

function setStoredThemeOverride(value) {
	try {
		if (!value) { localStorage.removeItem(THEME_OVERRIDE_KEY); return; }
		localStorage.setItem(THEME_OVERRIDE_KEY, value);
	} catch {}
}

function getEffectiveTheme() {
	const override = getStoredThemeOverride();
	if (override) return override;
	if (themeMode === "auto") return getSystemTheme();
	return themeMode;
}

function applyTheme(mode) {
	document.documentElement.dataset.theme = mode;
	document.documentElement.style.colorScheme = mode;
	const meta = document.querySelector('meta[name="theme-color"]');
	if (meta) meta.content = mode === "light" ? "#f8f8f8" : "#18181e";
}

function toggleTheme() {
	const currentTheme = getEffectiveTheme();
	const next = currentTheme === "dark" ? "light" : "dark";
	if (themeMode === "auto") {
		setStoredThemeOverride(next === getSystemTheme() ? null : next);
	} else {
		setStoredThemeOverride(next);
	}
	applyTheme(next);
}

function parseHotkey(value) {
	if (!value) return null;
	const parts = value.toLowerCase().split("+").map((p) => p.trim()).filter(Boolean);
	if (parts.length === 0) return null;
	const key = parts[parts.length - 1];
	const mods = parts.slice(0, -1);
	const hotkey = { key, mod: false, shift: false, alt: false };
	mods.forEach((m) => {
		if (m === "mod" || m === "cmd" || m === "meta" || m === "ctrl" || m === "control") hotkey.mod = true;
		else if (m === "shift") hotkey.shift = true;
		else if (m === "alt" || m === "option") hotkey.alt = true;
	});
	return key ? hotkey : null;
}

function matchesHotkey(event, hotkey) {
	if (event.key.toLowerCase() !== hotkey.key) return false;
	const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
	const modPressed = isMac ? event.metaKey : event.ctrlKey;
	if (hotkey.mod !== modPressed) return false;
	if (hotkey.shift !== event.shiftKey) return false;
	if (hotkey.alt !== event.altKey) return false;
	if (!hotkey.mod && (event.metaKey || event.ctrlKey)) return false;
	if (!hotkey.shift && event.shiftKey) return false;
	if (!hotkey.alt && event.altKey) return false;
	return true;
}

function initTheme() {
	applyTheme(getEffectiveTheme());

	if (themeMode === "auto") {
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		media.addEventListener("change", () => {
			if (!getStoredThemeOverride()) applyTheme(getSystemTheme());
		});
	}

	const hotkey = parseHotkey(themeToggleHotkey);
	if (hotkey) {
		const shortcut = document.getElementById("theme-shortcut");
		if (shortcut) {
			const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
			const parts = [];
			if (hotkey.mod) parts.push(isMac ? "⌘" : "Ctrl");
			if (hotkey.shift) parts.push("Shift");
			if (hotkey.alt) parts.push(isMac ? "Option" : "Alt");
			parts.push(hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key);
			shortcut.innerHTML = parts.map((p) => `<kbd>${p}</kbd>`).join("") + " Theme";
			shortcut.classList.remove("hidden");
		}
		document.addEventListener("keydown", (event) => {
			if (isTypingEvent(event) || isInsideDialog(event)) return;
			if (matchesHotkey(event, hotkey)) { event.preventDefault(); toggleTheme(); }
		});
	}
}

// ─── LAYOUT TOGGLE ───────────────────────────────────────────

const LAYOUT_KEY = "pi-deck-layout";

function getStoredLayout() {
	try {
		const value = localStorage.getItem(LAYOUT_KEY);
		return value === "1" || value === "2" || value === "3" || value === "4" ? value : null;
	} catch { return null; }
}

function setStoredLayout(value) {
	try {
		if (!value) {
			localStorage.removeItem(LAYOUT_KEY);
		} else {
			localStorage.setItem(LAYOUT_KEY, value);
		}
	} catch {}
}

function applyLayout(cols) {
	const deck = document.querySelector(".deck");
	if (!deck) return;
	if (cols) {
		deck.dataset.layout = cols;
	} else {
		delete deck.dataset.layout;
	}
	refreshActiveSlideLayout();
}

function updateLayoutButtons(activeCols) {
	const toggle = document.getElementById("layout-toggle");
	if (!toggle) return;
	toggle.querySelectorAll(".layout-btn").forEach((btn) => {
		const isActive = btn.dataset.cols === activeCols;
		btn.classList.toggle("active", isActive);
		btn.setAttribute("aria-pressed", isActive ? "true" : "false");
		// Update title to show "Auto" hint when clicking would reset
		const cols = btn.dataset.cols;
		btn.title = isActive ? `${cols} column${cols === "1" ? "" : "s"} (click for auto)` : `${cols} column${cols === "1" ? "" : "s"}`;
	});
}

function initLayoutToggle() {
	const stored = getStoredLayout();
	if (stored) {
		applyLayout(stored);
		updateLayoutButtons(stored);
	}

	const toggle = document.getElementById("layout-toggle");
	if (!toggle) return;

	toggle.addEventListener("click", (event) => {
		const btn = event.target.closest(".layout-btn");
		if (!btn) return;
		const cols = btn.dataset.cols;
		const stored = getStoredLayout();
		if (cols === stored) {
			// Clicking active button toggles back to auto
			setStoredLayout(null);
			applyLayout(null);
			updateLayoutButtons(null);
		} else {
			setStoredLayout(cols);
			applyLayout(cols);
			updateLayoutButtons(cols);
		}
	});
}

// ─── SELECTION PERSISTENCE ────────────────────────────────────

const SELECTIONS_KEY = `pi-deck-${typeof deckData.sessionId === "string" ? deckData.sessionId : "unknown"}`;

function saveSelectionsToStorage() {
	try { 
		const data = { selections, feedback };
		if (finalNotes) data.finalNotes = finalNotes;
		localStorage.setItem(SELECTIONS_KEY, JSON.stringify(data)); 
	} catch {}
}

function loadSelectionsFromStorage() {
	try {
		const saved = localStorage.getItem(SELECTIONS_KEY);
		if (!saved) return null;
		return JSON.parse(saved);
	} catch { return null; }
}

function clearSelectionsStorage() {
	try { localStorage.removeItem(SELECTIONS_KEY); } catch {}
}
