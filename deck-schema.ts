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
	columns?: 1 | 2 | 3;
	multiSelect?: boolean;
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
		if (obj.columns !== 1 && obj.columns !== 2 && obj.columns !== 3) {
			throw new Error(`Slide "${obj.id}": columns must be 1, 2, or 3`);
		}
	}

	if (obj.multiSelect !== undefined && typeof obj.multiSelect !== "boolean") {
		throw new Error(`Slide "${obj.id}": multiSelect must be a boolean`);
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

export type SelectionValue = string | string[];

export interface SavedDeckData {
	config: DeckConfig;
	selections: Record<string, SelectionValue>;
	savedAt: string;
	id?: string;
	status?: "submitted" | "in-progress" | "cancelled";
	modifiedAt?: string;
	notes?: Record<string, string>;
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

	const selections: Record<string, SelectionValue> = {};
	if (obj.selections && typeof obj.selections === "object" && !Array.isArray(obj.selections)) {
		for (const [key, val] of Object.entries(obj.selections as Record<string, unknown>)) {
			if (typeof val === "string") {
				selections[key] = val;
			} else if (Array.isArray(val) && val.every((v) => typeof v === "string")) {
				selections[key] = val as string[];
			}
		}
	}

	const notes: Record<string, string> = {};
	if (obj.notes && typeof obj.notes === "object" && !Array.isArray(obj.notes)) {
		for (const [key, val] of Object.entries(obj.notes as Record<string, unknown>)) {
			if (typeof val === "string") notes[key] = val;
		}
	}

	const status =
		obj.status === "submitted" || obj.status === "in-progress" || obj.status === "cancelled"
			? obj.status
			: undefined;

	return {
		config,
		selections,
		savedAt: typeof obj.savedAt === "string" ? obj.savedAt : new Date().toISOString(),
		id: typeof obj.id === "string" && obj.id.trim() !== "" ? obj.id : undefined,
		status,
		modifiedAt: typeof obj.modifiedAt === "string" ? obj.modifiedAt : undefined,
		notes: Object.keys(notes).length > 0 ? notes : undefined,
		finalNotes: typeof obj.finalNotes === "string" ? obj.finalNotes : undefined,
		savedFrom: obj.savedFrom && typeof obj.savedFrom === "object"
			? obj.savedFrom as SavedDeckData["savedFrom"]
			: undefined,
	};
}
