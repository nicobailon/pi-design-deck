export type PreviewBlock =
	| { type: "html"; content: string }
	| { type: "mermaid"; content: string; theme?: Record<string, string> }
	| { type: "code"; code: string; lang: string }
	| { type: "image"; src: string; alt: string; caption?: string };

export interface DeckOption {
	label: string;
	description?: string;
	aside?: string;
	previewHtml?: string;
	previewBlocks?: PreviewBlock[];
	recommended?: boolean;
}

export interface DeckSlide {
	id: string;
	title: string;
	context?: string;
	columns?: 1 | 2 | 3 | 4;
	options: DeckOption[];
}

export interface DeckConfig {
	title?: string;
	slides: DeckSlide[];
}

function validatePreviewBlock(block: unknown, slideId: string, label: string, index: number): PreviewBlock {
	if (!block || typeof block !== "object") {
		throw new Error(`Slide "${slideId}": option "${label}" previewBlocks[${index}] must be an object`);
	}

	const b = block as Record<string, unknown>;
	const validTypes = ["html", "mermaid", "code", "image"];

	if (typeof b.type !== "string" || !validTypes.includes(b.type)) {
		throw new Error(`Slide "${slideId}": option "${label}" previewBlocks[${index}] type must be one of: ${validTypes.join(", ")}`);
	}

	if (b.type === "html") {
		if (typeof b.content !== "string" || b.content.trim() === "") {
			throw new Error(`Slide "${slideId}": option "${label}" html block must have non-empty content`);
		}
	} else if (b.type === "mermaid") {
		if (typeof b.content !== "string" || b.content.trim() === "") {
			throw new Error(`Slide "${slideId}": option "${label}" mermaid block must have non-empty content`);
		}
		if (b.theme !== undefined) {
			if (!b.theme || typeof b.theme !== "object" || Array.isArray(b.theme)) {
				throw new Error(`Slide "${slideId}": option "${label}" mermaid block theme must be an object of string values`);
			}
			for (const [key, val] of Object.entries(b.theme as Record<string, unknown>)) {
				if (typeof val !== "string") {
					throw new Error(`Slide "${slideId}": option "${label}" mermaid block theme.${key} must be a string`);
				}
			}
		}
	} else if (b.type === "code") {
		if (typeof b.code !== "string" || b.code.trim() === "") {
			throw new Error(`Slide "${slideId}": option "${label}" code block must have non-empty code`);
		}
		if (typeof b.lang !== "string" || b.lang.trim() === "") {
			throw new Error(`Slide "${slideId}": option "${label}" code block must have non-empty lang`);
		}
	} else if (b.type === "image") {
		if (typeof b.src !== "string" || b.src.trim() === "") {
			throw new Error(`Slide "${slideId}": option "${label}" image block must have non-empty src`);
		}
		if (typeof b.alt !== "string" || b.alt.trim() === "") {
			throw new Error(`Slide "${slideId}": option "${label}" image block must have non-empty alt`);
		}
		if (b.caption !== undefined && typeof b.caption !== "string") {
			throw new Error(`Slide "${slideId}": option "${label}" image block caption must be a string`);
		}
	}

	return b as unknown as PreviewBlock;
}

function validateDeckOption(option: unknown, slideId: string, index: number): DeckOption {
	if (!option || typeof option !== "object") {
		throw new Error(`Slide "${slideId}": option at index ${index} must be an object`);
	}

	const obj = option as Record<string, unknown>;

	if (typeof obj.label !== "string" || obj.label.trim() === "") {
		throw new Error(`Slide "${slideId}": option at index ${index} must have a non-empty label`);
	}

	if (obj.previewHtml !== undefined && typeof obj.previewHtml !== "string") {
		throw new Error(
			`Slide "${slideId}": option "${obj.label}" previewHtml must be a string`
		);
	}

	const hasHtml = typeof obj.previewHtml === "string" && obj.previewHtml.trim() !== "";
	const hasBlocks = Array.isArray(obj.previewBlocks) && obj.previewBlocks.length > 0;

	if (hasHtml && hasBlocks) {
		throw new Error(
			`Slide "${slideId}": option "${obj.label}" must have either previewHtml or previewBlocks, not both`
		);
	}

	if (!hasHtml && !hasBlocks) {
		throw new Error(
			`Slide "${slideId}": option "${obj.label}" must have non-empty previewHtml or previewBlocks`
		);
	}

	if (hasBlocks) {
		for (let i = 0; i < (obj.previewBlocks as unknown[]).length; i++) {
			validatePreviewBlock((obj.previewBlocks as unknown[])[i], slideId, obj.label as string, i);
		}
	}

	if (obj.description !== undefined && typeof obj.description !== "string") {
		throw new Error(`Slide "${slideId}": option "${obj.label}" description must be a string`);
	}

	if (obj.aside !== undefined && typeof obj.aside !== "string") {
		throw new Error(`Slide "${slideId}": option "${obj.label}" aside must be a string`);
	}

	if (obj.recommended !== undefined && typeof obj.recommended !== "boolean") {
		throw new Error(`Slide "${slideId}": option "${obj.label}" recommended must be boolean`);
	}

	return obj as unknown as DeckOption;
}

function validateDeckSlide(slide: unknown, index: number): DeckSlide {
	if (!slide || typeof slide !== "object") {
		throw new Error(`Slide at index ${index} must be an object`);
	}

	const obj = slide as Record<string, unknown>;

	if (typeof obj.id !== "string" || obj.id.trim() === "") {
		throw new Error(`Slide at index ${index} must have a non-empty id`);
	}

	if (obj.id === "summary") {
		throw new Error(`Slide at index ${index}: id "summary" is reserved`);
	}

	if (typeof obj.title !== "string" || obj.title.trim() === "") {
		throw new Error(`Slide "${obj.id}": title must be a non-empty string`);
	}

	if (obj.context !== undefined && typeof obj.context !== "string") {
		throw new Error(`Slide "${obj.id}": context must be a string`);
	}

	if (obj.columns !== undefined) {
		if (obj.columns !== 1 && obj.columns !== 2 && obj.columns !== 3 && obj.columns !== 4) {
			throw new Error(`Slide "${obj.id}": columns must be 1, 2, 3, or 4`);
		}
	}

	if (!Array.isArray(obj.options) || obj.options.length === 0) {
		throw new Error(`Slide "${obj.id}": options must be a non-empty array`);
	}

	obj.options.forEach((option, optionIndex) => {
		validateDeckOption(option, obj.id as string, optionIndex);
	});

	return obj as unknown as DeckSlide;
}

export function isDeckOption(value: unknown): value is DeckOption {
	if (!value || typeof value !== "object") return false;
	const obj = value as Record<string, unknown>;
	if (typeof obj.label !== "string" || obj.label.trim() === "") return false;
	if (obj.previewHtml !== undefined && typeof obj.previewHtml !== "string") return false;

	const hasHtml = typeof obj.previewHtml === "string" && obj.previewHtml.trim() !== "";
	const hasBlocks = Array.isArray(obj.previewBlocks) && obj.previewBlocks.length > 0;
	if (!hasHtml && !hasBlocks) return false;
	if (hasHtml && hasBlocks) return false;

	if (hasBlocks) {
		try {
			for (let i = 0; i < (obj.previewBlocks as unknown[]).length; i++) {
				validatePreviewBlock((obj.previewBlocks as unknown[])[i], "check", obj.label as string, i);
			}
		} catch {
			return false;
		}
	}

	if (obj.description !== undefined && typeof obj.description !== "string") return false;
	if (obj.aside !== undefined && typeof obj.aside !== "string") return false;
	if (obj.recommended !== undefined && typeof obj.recommended !== "boolean") return false;
	return true;
}

export function validateDeckConfig(data: unknown): DeckConfig {
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		throw new Error("Deck config must be an object");
	}

	const obj = data as Record<string, unknown>;

	if (obj.title !== undefined && typeof obj.title !== "string") {
		throw new Error("Deck config title must be a string");
	}

	if (!Array.isArray(obj.slides) || obj.slides.length === 0) {
		throw new Error("Deck config slides must be a non-empty array");
	}

	const ids = new Set<string>();
	obj.slides.forEach((slide, index) => {
		const validated = validateDeckSlide(slide, index);
		if (ids.has(validated.id)) {
			throw new Error(`Duplicate slide id: "${validated.id}"`);
		}
		ids.add(validated.id);
	});

	return obj as unknown as DeckConfig;
}

export interface DeckPin {
	id: string;
	target: "option" | "image";
	/** Index into the option's previewBlocks for image pins; -1 for pins on the whole preview. */
	blockIndex: number;
	/** 0–1 fractions of the target's box, measured from its top-left corner. */
	x: number;
	y: number;
	text: string;
}

export interface OptionFeedback {
	note: string;
	pins: DeckPin[];
}

/** slideId → option label → feedback. Covers every option the user commented on, selected or not. */
export type DeckNotes = Record<string, Record<string, OptionFeedback>>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function validatePin(pin: unknown, option: DeckOption, where: string): DeckPin {
	if (!isPlainObject(pin)) throw new Error(`${where} must be an object`);
	if (typeof pin.id !== "string" || pin.id.trim() === "") throw new Error(`${where}.id must be a non-empty string`);
	if (pin.target !== "option" && pin.target !== "image") throw new Error(`${where}.target must be "option" or "image"`);
	if (typeof pin.blockIndex !== "number" || !Number.isInteger(pin.blockIndex)) {
		throw new Error(`${where}.blockIndex must be an integer`);
	}
	if (pin.target === "option" && pin.blockIndex !== -1) {
		throw new Error(`${where}.blockIndex must be -1 for option pins`);
	}
	if (pin.target === "image" && option.previewBlocks?.[pin.blockIndex]?.type !== "image") {
		throw new Error(`${where}.blockIndex must point to an image block of option "${option.label}"`);
	}
	for (const axis of ["x", "y"] as const) {
		const value = pin[axis];
		if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
			throw new Error(`${where}.${axis} must be a number from 0 to 1`);
		}
	}
	if (typeof pin.text !== "string" || pin.text.trim() === "") throw new Error(`${where}.text must be a non-empty string`);
	return { id: pin.id, target: pin.target, blockIndex: pin.blockIndex, x: pin.x as number, y: pin.y as number, text: pin.text };
}

/** Validates feedback against the deck it belongs to, so every pin resolves to a real option and image. */
export function validateDeckNotes(value: unknown, config: DeckConfig): DeckNotes {
	if (!isPlainObject(value)) throw new Error("notes must map slide ids to option feedback");
	const out: DeckNotes = {};
	for (const [slideId, byLabel] of Object.entries(value)) {
		const slide = config.slides.find((s) => s.id === slideId);
		if (!slide) throw new Error(`notes: unknown slide "${slideId}"`);
		if (!isPlainObject(byLabel)) throw new Error(`notes.${slideId} must map option labels to feedback`);
		const slideOut: Record<string, OptionFeedback> = {};
		for (const [label, entry] of Object.entries(byLabel)) {
			const where = `notes.${slideId}["${label}"]`;
			const option = slide.options.find((o) => o.label === label);
			if (!option) throw new Error(`${where}: unknown option`);
			if (!isPlainObject(entry)) throw new Error(`${where} must be { note, pins }`);
			if (typeof entry.note !== "string") throw new Error(`${where}.note must be a string`);
			if (!Array.isArray(entry.pins)) throw new Error(`${where}.pins must be an array`);
			const pins = entry.pins.map((pin, i) => validatePin(pin, option, `${where}.pins[${i}]`));
			if (new Set(pins.map((p) => p.id)).size !== pins.length) throw new Error(`${where}.pins ids must be unique`);
			if (entry.note.trim() === "" && pins.length === 0) throw new Error(`${where} must have a note or pins`);
			slideOut[label] = { note: entry.note, pins };
		}
		if (Object.keys(slideOut).length > 0) out[slideId] = slideOut;
	}
	return out;
}

/** One agent-readable line per pin, e.g. `#2 (image 1, 62%, 18%): logo too small`. */
export function describePin(option: DeckOption, pin: DeckPin, index: number): string {
	const where = pin.target === "image"
		? `image ${(option.previewBlocks ?? []).slice(0, pin.blockIndex + 1).filter((b) => b.type === "image").length}`
		: "preview";
	return `#${index + 1} (${where}, ${Math.round(pin.x * 100)}%, ${Math.round(pin.y * 100)}%): ${pin.text}`;
}

export interface SavedDeckData {
	config: DeckConfig;
	selections: Record<string, string>;
	savedAt: string;
	id?: string;
	status?: "submitted" | "in-progress" | "cancelled";
	modifiedAt?: string;
	notes?: DeckNotes;
	finalNotes?: string;
	savedFrom?: {
		cwd: string;
		branch: string | null;
		sessionId: string;
	};
}

export type SavedDeckStatus = NonNullable<SavedDeckData["status"]>;

export function deriveDeckStatusFromFolderName(folderName: string): SavedDeckStatus {
	if (folderName.endsWith("-submitted")) return "submitted";
	if (folderName.endsWith("-cancelled")) return "cancelled";
	return "in-progress";
}

export function validateSavedDeck(data: unknown): SavedDeckData {
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		throw new Error("Invalid saved deck: must be an object");
	}

	const obj = data as Record<string, unknown>;
	const config = validateDeckConfig(obj.config);

	const selections: Record<string, string> = {};
	if (obj.selections && typeof obj.selections === "object" && !Array.isArray(obj.selections)) {
		for (const [key, val] of Object.entries(obj.selections as Record<string, unknown>)) {
			if (typeof val === "string") selections[key] = val;
		}
	}

	const notes = obj.notes === undefined ? {} : validateDeckNotes(obj.notes, config);

	const status =
		obj.status === "submitted" || obj.status === "in-progress" || obj.status === "cancelled"
			? obj.status
			: undefined;

	return {
		config,
		selections,
		savedAt: typeof obj.savedAt === "string" ? obj.savedAt : new Date().toISOString(),
		...(typeof obj.id === "string" && obj.id.trim() !== "" ? { id: obj.id } : {}),
		...(status !== undefined ? { status } : {}),
		...(typeof obj.modifiedAt === "string" ? { modifiedAt: obj.modifiedAt } : {}),
		...(Object.keys(notes).length > 0 ? { notes } : {}),
		...(typeof obj.finalNotes === "string" ? { finalNotes: obj.finalNotes } : {}),
		...(obj.savedFrom && typeof obj.savedFrom === "object"
			? { savedFrom: obj.savedFrom as NonNullable<SavedDeckData["savedFrom"]> }
			: {}),
	};
}
