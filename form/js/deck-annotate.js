// ─── COMMENT MODE ────────────────────────────────────────────

const COMMENT_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5h10a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 13 11.5H7l-3.5 2.5v-2.5H3A1.5 1.5 0 0 1 1.5 10V4A1.5 1.5 0 0 1 3 2.5Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';

function createCommentToggle() {
	const button = createElement("button", "comment-toggle");
	button.type = "button";
	button.setAttribute("aria-pressed", String(commentMode));
	button.title = "Comment mode: click a preview to pin a comment (C)";
	button.innerHTML = `${COMMENT_ICON}<span>Comment</span><kbd>C</kbd>`;
	button.addEventListener("click", (event) => {
		event.stopPropagation();
		setCommentMode(!commentMode);
	});
	return button;
}

function setCommentMode(on) {
	commentMode = on;
	document.querySelector(".deck")?.classList.toggle("commenting", on);
	viewer?.dialog.classList.toggle("commenting", on);
	document.querySelectorAll(".comment-toggle").forEach((button) => button.setAttribute("aria-pressed", String(on)));
	if (!on) document.querySelectorAll(".pin-target").forEach((el) => el.classList.remove("pin-target"));
}

// ─── PIN GEOMETRY ────────────────────────────────────────────

function clamp01(value) {
	return Math.min(1, Math.max(0, value));
}

function fractionIn(el, clientX, clientY) {
	const rect = el.getBoundingClientRect();
	return { x: clamp01((clientX - rect.left) / rect.width), y: clamp01((clientY - rect.top) / rect.height) };
}

function contains(rect, x, y) {
	return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

// Images win over the surrounding preview, so a pin on an image follows that image.
function hitTarget(card, clientX, clientY) {
	for (const frame of card.querySelectorAll(".image-frame")) {
		if (contains(frame.getBoundingClientRect(), clientX, clientY)) {
			return { el: frame, target: "image", blockIndex: Number(frame.dataset.blockIndex) };
		}
	}
	const surface = card.querySelector(".preview-surface");
	if (surface && contains(surface.getBoundingClientRect(), clientX, clientY)) {
		return { el: surface, target: "option", blockIndex: -1 };
	}
	return null;
}

function pinLayerFor(card, pin) {
	const host = pin.target === "image"
		? card.querySelector(`.image-frame[data-block-index="${pin.blockIndex}"]`)
		: card.querySelector(".preview-surface");
	if (!host) throw new Error(`No ${pin.target} target for pin ${pin.id}`);
	return host.querySelector(":scope > .pin-layer");
}

function pinWhere(card, pin) {
	if (pin.target !== "image") return "Preview";
	const option = findOption(card.dataset.slideId, card.dataset.value);
	const ordinal = option.previewBlocks.slice(0, pin.blockIndex + 1).filter((b) => b.type === "image").length;
	return `Image ${ordinal}`;
}

function newPinId() {
	return crypto.randomUUID().slice(0, 8);
}

function cardPins(card) {
	return getFeedback(card.dataset.slideId, card.dataset.value)?.pins || [];
}

function findCard(slideId, label) {
	const slideEl = document.querySelector(`.slide[data-id="${CSS.escape(slideId)}"]`);
	return slideEl ? Array.from(slideEl.querySelectorAll(".option")).find((el) => el.dataset.value === label) || null : null;
}

function savePins() {
	saveSelectionsToStorage();
	markDirty();
}

// ─── PIN MARKERS & LIST ──────────────────────────────────────

// Flip the marker near the right/top edge so the preview's overflow never clips it.
function setMarkerFlip(marker, pin) {
	marker.classList.toggle("pin-flip-x", pin.x > 0.85);
	marker.classList.toggle("pin-flip-y", pin.y < 0.12);
}

function createPinMarker(card, pin, index, toFraction, place) {
	const marker = createElement("button", "pin", String(index + 1));
	marker.type = "button";
	marker.dataset.pinId = pin.id;
	marker.setAttribute("aria-label", `Comment ${index + 1}${pin.text ? `: ${pin.text}` : ""}`);
	place(marker, pin);
	setMarkerFlip(marker, pin);

	let drag = null;
	let justDragged = false;
	marker.addEventListener("pointerdown", (event) => {
		if (event.button !== 0) return;
		event.stopPropagation();
		event.preventDefault();
		marker.setPointerCapture(event.pointerId);
		drag = { x: event.clientX, y: event.clientY, moved: false };
	});
	marker.addEventListener("pointermove", (event) => {
		if (!drag) return;
		if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
		drag.moved = true;
		marker.classList.add("dragging");
		const point = toFraction(event.clientX, event.clientY);
		pin.x = point.x;
		pin.y = point.y;
		place(marker, pin);
		setMarkerFlip(marker, pin);
		repositionPinPopover();
	});
	const endDrag = () => {
		if (!drag) return;
		const moved = drag.moved;
		drag = null;
		marker.classList.remove("dragging");
		if (moved) {
			justDragged = true;
			savePins();
			renderPins(card);
		} else {
			togglePinPopover(card, pin.id);
		}
	};
	marker.addEventListener("pointerup", endDrag);
	marker.addEventListener("pointercancel", () => { drag = null; marker.classList.remove("dragging"); });
	marker.addEventListener("click", (event) => {
		event.stopPropagation();
		// Pointer clicks are handled on pointerup; this path is keyboard activation.
		if (event.detail === 0 && !justDragged) togglePinPopover(card, pin.id);
		justDragged = false;
	});
	marker.addEventListener("pointerenter", () => highlightPin(card, pin.id, true));
	marker.addEventListener("pointerleave", () => highlightPin(card, pin.id, false));
	return marker;
}

function highlightPin(card, pinId, on) {
	const selector = `[data-pin-id="${CSS.escape(pinId)}"]`;
	card.querySelectorAll(selector).forEach((el) => el.classList.toggle("pin-hot", on));
	if (viewer?.state?.card === card) viewer.pins.querySelectorAll(selector).forEach((el) => el.classList.toggle("pin-hot", on));
}

function placeInLayer(marker, pin) {
	marker.style.left = `${pin.x * 100}%`;
	marker.style.top = `${pin.y * 100}%`;
}

function renderPins(card) {
	const pins = cardPins(card);
	card.querySelectorAll(".pin-layer > .pin").forEach((el) => el.remove());
	pins.forEach((pin, index) => {
		const layer = pinLayerFor(card, pin);
		const box = layer.parentElement;
		layer.appendChild(createPinMarker(card, pin, index, (x, y) => fractionIn(box, x, y), placeInLayer));
	});
	renderPinList(card);
	if (viewer?.state?.card === card) renderViewerPins();
}

function renderPinList(card) {
	const list = card.querySelector(".pin-list");
	const pins = cardPins(card);
	list.innerHTML = "";
	list.hidden = pins.length === 0;
	pins.forEach((pin, index) => {
		const item = createElement("li");
		const button = createElement("button", "pin-list-item");
		button.type = "button";
		button.dataset.pinId = pin.id;
		button.appendChild(createElement("span", "pin-badge", String(index + 1)));
		const text = createElement("span", "pin-list-text", pin.text || "Empty comment");
		if (!pin.text) text.classList.add("empty");
		button.appendChild(text);
		button.appendChild(createElement("span", "pin-list-where", pinWhere(card, pin)));
		button.addEventListener("click", (event) => {
			event.stopPropagation();
			openPinPopover(card, pin.id);
		});
		button.addEventListener("pointerenter", () => highlightPin(card, pin.id, true));
		button.addEventListener("pointerleave", () => highlightPin(card, pin.id, false));
		item.appendChild(button);
		list.appendChild(item);
	});
}

function dropPin(card, target, blockIndex, point) {
	const entry = ensureFeedback(card.dataset.slideId, card.dataset.value);
	const pin = { id: newPinId(), target, blockIndex, x: point.x, y: point.y, text: "" };
	entry.pins.push(pin);
	renderPins(card);
	openPinPopover(card, pin.id);
}

function removePin(card, pinId) {
	const { slideId, value: label } = card.dataset;
	const entry = getFeedback(slideId, label);
	if (!entry) return;
	entry.pins = entry.pins.filter((pin) => pin.id !== pinId);
	pruneFeedback(slideId, label);
	savePins();
	renderPins(card);
}

// In comment mode the preview is a canvas: its own links, buttons and inputs must stay inert.
function initPinSurface(card, surface) {
	const isOwnControl = (event) => event.target instanceof Element && !!event.target.closest(".pin, .image-expand");
	surface.addEventListener("click", (event) => {
		if (!commentMode || isOwnControl(event)) return;
		event.preventDefault();
		event.stopPropagation();
		const hit = hitTarget(card, event.clientX, event.clientY);
		if (hit) dropPin(card, hit.target, hit.blockIndex, fractionIn(hit.el, event.clientX, event.clientY));
	}, true);
	for (const type of ["pointerdown", "mousedown", "dblclick", "auxclick", "submit"]) {
		surface.addEventListener(type, (event) => {
			if (!commentMode || isOwnControl(event)) return;
			event.preventDefault();
			event.stopPropagation();
		}, true);
	}
	surface.addEventListener("pointermove", (event) => {
		if (!commentMode) return;
		const hit = hitTarget(card, event.clientX, event.clientY);
		card.querySelectorAll(".pin-target").forEach((el) => { if (el !== hit?.el) el.classList.remove("pin-target"); });
		hit?.el.classList.add("pin-target");
	});
	surface.addEventListener("pointerleave", () => {
		card.querySelectorAll(".pin-target").forEach((el) => el.classList.remove("pin-target"));
	});
}

// ─── PIN POPOVER ─────────────────────────────────────────────

let popover = null;

function popoverMarker() {
	if (!popover) return null;
	const selector = `.pin[data-pin-id="${CSS.escape(popover.pinId)}"]`;
	return popover.inViewer ? viewer.pins.querySelector(selector) : popover.card.querySelector(selector);
}

function togglePinPopover(card, pinId) {
	if (popover && popover.card === card && popover.pinId === pinId) {
		closePinPopover();
		return;
	}
	openPinPopover(card, pinId);
}

function openPinPopover(card, pinId) {
	if (popover) closePinPopover();
	const pins = cardPins(card);
	const index = pins.findIndex((p) => p.id === pinId);
	const pin = pins[index];
	if (!pin) return;
	const inViewer = !!viewer?.dialog.open && viewer.state.card === card;

	const el = createElement("div", "pin-popover");
	el.setAttribute("role", "dialog");
	el.setAttribute("aria-label", `Comment ${index + 1}`);
	const head = createElement("div", "pin-popover-head");
	head.appendChild(createElement("span", "pin-badge", String(index + 1)));
	head.appendChild(createElement("span", "pin-popover-title", `Comment on ${pinWhere(card, pin).toLowerCase()}`));
	const del = createElement("button", "pin-popover-delete", "Delete");
	del.type = "button";
	head.appendChild(del);
	el.appendChild(head);

	const input = createElement("textarea", "pin-popover-input");
	input.rows = 2;
	input.placeholder = "What should change here?";
	input.setAttribute("aria-label", `Comment ${index + 1}`);
	input.value = pin.text;
	el.appendChild(input);

	const foot = createElement("div", "pin-popover-foot");
	foot.appendChild(createElement("span", "pin-popover-hint", "Enter to save · Shift+Enter for a new line"));
	const done = createElement("button", "pin-popover-done", "Done");
	done.type = "button";
	foot.appendChild(done);
	el.appendChild(foot);

	input.addEventListener("input", () => {
		pin.text = input.value;
		autosizeField(input);
		renderPinList(card);
		savePins();
	});
	input.addEventListener("keydown", (event) => {
		// Cmd/Ctrl combos (save, submit) belong to the document shortcuts.
		if (event.isComposing || event.keyCode === 229 || isModKey(event)) return;
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			event.stopPropagation();
			closePinPopover({ focusMarker: true });
		} else if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			closePinPopover({ focusMarker: true });
		}
	});
	del.addEventListener("click", () => {
		closePinPopover();
		removePin(card, pinId);
		card.focus({ preventScroll: true });
	});
	done.addEventListener("click", () => closePinPopover({ focusMarker: true }));
	el.addEventListener("click", (event) => event.stopPropagation());

	(inViewer ? viewer.dialog : document.body).appendChild(el);
	popover = { el, card, pinId, inViewer };
	popoverMarker()?.classList.add("pin-active");
	autosizeField(input);
	repositionPinPopover();
	input.focus({ preventScroll: true });
}

// Empty comments are discarded on close, so a stray click never leaves a blank pin.
function closePinPopover({ focusMarker = false } = {}) {
	if (!popover) return;
	const { el, card, pinId } = popover;
	popover = null;
	el.remove();
	const pin = cardPins(card).find((p) => p.id === pinId);
	if (pin && !pin.text.trim()) {
		removePin(card, pinId);
		return;
	}
	renderPins(card);
	if (focusMarker) {
		const selector = `.pin[data-pin-id="${CSS.escape(pinId)}"]`;
		const marker = viewer?.dialog.open ? viewer.pins.querySelector(selector) : card.querySelector(selector);
		marker?.focus({ preventScroll: true });
	}
}

function repositionPinPopover() {
	if (!popover) return;
	const marker = popoverMarker();
	if (!marker) {
		closePinPopover();
		return;
	}
	const anchor = marker.getBoundingClientRect();
	const box = popover.el.getBoundingClientRect();
	const gap = 10;
	let left = anchor.right + gap;
	if (left + box.width > window.innerWidth - 8) left = anchor.left - box.width - gap;
	left = Math.max(8, left);
	const top = Math.min(Math.max(8, anchor.top - 6), window.innerHeight - box.height - 8);
	popover.el.style.left = `${left}px`;
	popover.el.style.top = `${top}px`;
}

document.addEventListener("pointerdown", (event) => {
	if (!popover || !(event.target instanceof Element)) return;
	if (event.target.closest(".pin-popover, .pin, .pin-list-item")) return;
	closePinPopover();
}, true);

document.addEventListener("scroll", () => repositionPinPopover(), true);

let resizeFrame = 0;
window.addEventListener("resize", () => {
	cancelAnimationFrame(resizeFrame);
	resizeFrame = requestAnimationFrame(() => {
		refreshActiveSlideLayout();
		if (viewer?.dialog.open) viewerRefit();
	});
});

// ─── IMAGE VIEWER ────────────────────────────────────────────

let viewer = null;

function buildViewer() {
	const dialog = createElement("dialog", "image-viewer");
	dialog.setAttribute("aria-label", "Image viewer");

	const bar = createElement("div", "viewer-bar");
	const title = createElement("div", "viewer-title");
	bar.appendChild(title);
	const tools = createElement("div", "viewer-tools");
	const zoomOut = createElement("button", "viewer-btn", "\u2212");
	zoomOut.type = "button";
	zoomOut.setAttribute("aria-label", "Zoom out");
	const zoomLabel = createElement("button", "viewer-btn viewer-zoom", "100%");
	zoomLabel.type = "button";
	zoomLabel.title = "Fit to window (0)";
	const zoomIn = createElement("button", "viewer-btn", "+");
	zoomIn.type = "button";
	zoomIn.setAttribute("aria-label", "Zoom in");
	const close = createElement("button", "viewer-btn viewer-close", "\u2715");
	close.type = "button";
	close.setAttribute("aria-label", "Close image viewer");
	tools.append(zoomOut, zoomLabel, zoomIn, createCommentToggle(), close);
	bar.appendChild(tools);
	dialog.appendChild(bar);

	const stage = createElement("div", "viewer-stage");
	const img = createElement("img", "viewer-img");
	img.draggable = false;
	const pins = createElement("div", "viewer-pins");
	stage.append(img, pins);
	dialog.appendChild(stage);

	const meta = createElement("div", "viewer-meta");
	const caption = createElement("div", "viewer-caption");
	const alt = createElement("div", "viewer-alt");
	meta.append(caption, alt);
	dialog.appendChild(meta);
	document.body.appendChild(dialog);

	viewer = { dialog, title, zoomLabel, stage, img, pins, caption, alt, state: null };

	zoomIn.addEventListener("click", () => zoomAtCenter(1.25));
	zoomOut.addEventListener("click", () => zoomAtCenter(0.8));
	zoomLabel.addEventListener("click", () => viewerFit());
	close.addEventListener("click", () => dialog.close());
	dialog.addEventListener("click", (event) => {
		if (event.target === dialog) dialog.close();
	});
	dialog.addEventListener("cancel", (event) => {
		if (popover?.inViewer) {
			event.preventDefault();
			closePinPopover();
		}
	});
	dialog.addEventListener("close", () => {
		if (popover?.inViewer) closePinPopover();
		const card = viewer.state?.card;
		viewer.state = null;
		img.removeAttribute("src");
		card?.focus({ preventScroll: true });
	});
	dialog.addEventListener("keydown", (event) => {
		if (isTypingEvent(event) || event.metaKey || event.ctrlKey || event.altKey) return;
		if (event.key === "+" || event.key === "=") zoomAtCenter(1.25);
		else if (event.key === "-") zoomAtCenter(0.8);
		else if (event.key === "0") viewerFit();
		else if (event.key === "c" || event.key === "C") setCommentMode(!commentMode);
		else return;
		event.preventDefault();
	});

	stage.addEventListener("wheel", (event) => {
		event.preventDefault();
		// Trackpad pinch arrives as ctrl+wheel with small deltas; scroll wheels need a gentler curve.
		const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
		zoomAt(event.clientX, event.clientY, viewer.state.scale * factor);
	}, { passive: false });
	// Safari/WebKit (Glimpse) reports trackpad pinch as gesture events instead of ctrl+wheel.
	stage.addEventListener("gesturestart", (event) => {
		event.preventDefault();
		viewer.state.gestureScale = viewer.state.scale;
	});
	stage.addEventListener("gesturechange", (event) => {
		event.preventDefault();
		zoomAt(event.clientX, event.clientY, viewer.state.gestureScale * event.scale);
	});

	const pointers = new Map();
	let gesture = null;
	stage.addEventListener("pointerdown", (event) => {
		if (event.button !== 0) return;
		stage.setPointerCapture(event.pointerId);
		pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		const s = viewer.state;
		if (pointers.size === 1) {
			gesture = { kind: "pan", x: event.clientX, y: event.clientY, tx: s.tx, ty: s.ty, moved: false };
		} else if (pointers.size === 2) {
			const [a, b] = [...pointers.values()];
			gesture = { kind: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y), scale: s.scale, moved: true };
		}
	});
	stage.addEventListener("pointermove", (event) => {
		if (!pointers.has(event.pointerId) || !gesture) return;
		pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		const s = viewer.state;
		if (gesture.kind === "pinch" && pointers.size === 2) {
			const [a, b] = [...pointers.values()];
			zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, gesture.scale * (Math.hypot(a.x - b.x, a.y - b.y) / gesture.dist));
			return;
		}
		if (gesture.kind !== "pan") return;
		const dx = event.clientX - gesture.x;
		const dy = event.clientY - gesture.y;
		if (!gesture.moved && Math.hypot(dx, dy) < 4) return;
		gesture.moved = true;
		stage.classList.add("panning");
		s.tx = gesture.tx + dx;
		s.ty = gesture.ty + dy;
		applyViewerTransform();
	});
	const endPointer = (event) => {
		if (!pointers.delete(event.pointerId)) return;
		stage.classList.remove("panning");
		const ended = gesture;
		if (pointers.size > 0) return;
		gesture = null;
		if (event.type !== "pointerup" || !ended || ended.moved || !commentMode) return;
		const point = viewerFraction(event.clientX, event.clientY, false);
		if (point) dropPin(viewer.state.card, "image", viewer.state.blockIndex, point);
	};
	stage.addEventListener("pointerup", endPointer);
	stage.addEventListener("pointercancel", endPointer);
	stage.addEventListener("dblclick", (event) => {
		if (commentMode) return;
		const s = viewer.state;
		if (s.scale > s.fit * 1.01) viewerFit();
		else zoomAt(event.clientX, event.clientY, Math.max(1, s.fit * 2.5));
	});
}

function openImageViewer(card, blockIndex) {
	if (!viewer) buildViewer();
	if (popover) closePinPopover();
	const option = findOption(card.dataset.slideId, card.dataset.value);
	const block = option.previewBlocks[blockIndex];
	const ordinal = option.previewBlocks.slice(0, blockIndex + 1).filter((b) => b.type === "image").length;
	viewer.state = { card, blockIndex, natW: 0, natH: 0, scale: 1, fit: 1, tx: 0, ty: 0 };
	viewer.title.textContent = `${option.label} \u00b7 Image ${ordinal}`;
	viewer.caption.textContent = block.caption || "";
	viewer.caption.hidden = !block.caption;
	viewer.alt.textContent = block.alt;
	viewer.img.alt = block.alt;
	viewer.dialog.classList.toggle("commenting", commentMode);
	viewer.dialog.classList.remove("ready");
	viewer.pins.innerHTML = "";
	viewer.img.src = block.src;
	viewer.dialog.showModal();
	viewer.dialog.querySelector(".viewer-close").focus({ preventScroll: true });
	const start = () => {
		if (viewer.state?.card !== card) return;
		viewer.state.natW = viewer.img.naturalWidth || viewer.stage.clientWidth;
		viewer.state.natH = viewer.img.naturalHeight || viewer.stage.clientHeight;
		renderViewerPins();
		viewerFit();
		viewer.dialog.classList.add("ready");
	};
	if (viewer.img.complete && viewer.img.naturalWidth) start();
	else viewer.img.addEventListener("load", start, { once: true });
}

function viewerFit() {
	const s = viewer.state;
	const w = viewer.stage.clientWidth;
	const h = viewer.stage.clientHeight;
	s.fit = Math.min(w / s.natW, h / s.natH);
	s.scale = s.fit;
	s.tx = (w - s.natW * s.scale) / 2;
	s.ty = (h - s.natH * s.scale) / 2;
	applyViewerTransform();
}

function viewerRefit() {
	const s = viewer.state;
	if (!s) return;
	const wasFit = Math.abs(s.scale - s.fit) < 1e-6;
	s.fit = Math.min(viewer.stage.clientWidth / s.natW, viewer.stage.clientHeight / s.natH);
	if (wasFit) viewerFit();
	else applyViewerTransform();
}

function zoomAt(clientX, clientY, nextScale) {
	const s = viewer.state;
	const rect = viewer.stage.getBoundingClientRect();
	const scale = Math.min(Math.max(nextScale, s.fit * 0.5), Math.max(8, s.fit * 8));
	const px = clientX - rect.left;
	const py = clientY - rect.top;
	s.tx = px - ((px - s.tx) * scale) / s.scale;
	s.ty = py - ((py - s.ty) * scale) / s.scale;
	s.scale = scale;
	applyViewerTransform();
}

function zoomAtCenter(factor) {
	const rect = viewer.stage.getBoundingClientRect();
	zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, viewer.state.scale * factor);
}

// Keeps the image on screen: centred when smaller than the stage, edge-bounded when larger.
function clampViewerPan() {
	const s = viewer.state;
	const w = viewer.stage.clientWidth;
	const h = viewer.stage.clientHeight;
	const iw = s.natW * s.scale;
	const ih = s.natH * s.scale;
	s.tx = iw <= w ? (w - iw) / 2 : Math.min(0, Math.max(w - iw, s.tx));
	s.ty = ih <= h ? (h - ih) / 2 : Math.min(0, Math.max(h - ih, s.ty));
}

function applyViewerTransform() {
	const s = viewer.state;
	clampViewerPan();
	viewer.img.style.width = `${s.natW}px`;
	viewer.img.style.height = `${s.natH}px`;
	viewer.img.style.transform = `translate(${s.tx}px, ${s.ty}px) scale(${s.scale})`;
	viewer.zoomLabel.textContent = `${Math.round(s.scale * 100)}%`;
	viewer.pins.querySelectorAll(".pin").forEach((marker) => {
		const pin = cardPins(s.card).find((p) => p.id === marker.dataset.pinId);
		if (pin) placeInViewer(marker, pin);
	});
	repositionPinPopover();
}

function placeInViewer(marker, pin) {
	const s = viewer.state;
	marker.style.left = `${s.tx + pin.x * s.natW * s.scale}px`;
	marker.style.top = `${s.ty + pin.y * s.natH * s.scale}px`;
}

function viewerFraction(clientX, clientY, clampToImage) {
	const s = viewer.state;
	const rect = viewer.stage.getBoundingClientRect();
	const x = (clientX - rect.left - s.tx) / (s.natW * s.scale);
	const y = (clientY - rect.top - s.ty) / (s.natH * s.scale);
	if (!clampToImage && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
	return { x: clamp01(x), y: clamp01(y) };
}

function renderViewerPins() {
	const s = viewer.state;
	viewer.pins.innerHTML = "";
	cardPins(s.card).forEach((pin, index) => {
		if (pin.target !== "image" || pin.blockIndex !== s.blockIndex) return;
		viewer.pins.appendChild(createPinMarker(s.card, pin, index, (x, y) => viewerFraction(x, y, true), placeInViewer));
	});
}
