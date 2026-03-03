import { Type } from "@sinclair/typebox";
import { Text } from "@mariozechner/pi-tui";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import { loadSettings } from "./settings.js";
import { getDefaultSnapshotDir, startDeckServer, type DeckServerHandle, type ModelInfo } from "./deck-server.js";
import { deriveDeckStatusFromFolderName, isDeckOption, validateDeckConfig, validateSavedDeck, type SavedDeckData, type SavedDeckStatus, type SelectionValue } from "./deck-schema.js";
import { buildGenerateMoreResult, buildRegenerateResult } from "./generate-prompts.js";
import { generateWithModel } from "./model-runner.js";
import { buildStandaloneDeckHtml } from "./export-html.js";

async function openUrl(pi: ExtensionAPI, url: string, browser?: string): Promise<void> {
	const platform = os.platform();
	let result;
	if (platform === "darwin") {
		if (browser) {
			result = await pi.exec("open", ["-a", browser, url]);
		} else {
			result = await pi.exec("open", [url]);
		}
	} else if (platform === "win32") {
		if (browser) {
			result = await pi.exec("cmd", ["/c", "start", "", browser, url]);
		} else {
			result = await pi.exec("cmd", ["/c", "start", "", url]);
		}
	} else {
		if (browser) {
			result = await pi.exec(browser, [url]);
		} else {
			result = await pi.exec("xdg-open", [url]);
		}
	}
	if (result.code !== 0) {
		throw new Error(result.stderr || `Failed to open browser (exit code ${result.code})`);
	}
}

interface DeckDetails {
	status: "completed" | "cancelled" | "generate-more" | "aborted" | "error";
	url: string;
	selections?: Record<string, SelectionValue>;
	notes?: Record<string, string>;
	finalNotes?: string;
	slideId?: string;
	reason?: string;
}

interface DeckToolResult {
	content: Array<{ type: "text"; text: string }>;
	details: DeckDetails;
}

let activeDeckServer: {
	handle: DeckServerHandle;
	currentResolve: ((result: DeckToolResult) => void) | null;
} | null = null;

let activeDeckIdleTimer: NodeJS.Timeout | null = null;
let pendingDeckResult: DeckToolResult | null = null;
let restoreDeckThinking: (() => void) | null = null;

const DECK_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

interface SavedDeckListItem {
	id: string;
	title: string;
	savedAt: string;
	modifiedAt: string;
	status: SavedDeckStatus;
	cwd?: string;
	branch?: string | null;
	slideCount: number;
}

interface LoadedDeckSource {
	configData: unknown;
	savedSelections?: Record<string, SelectionValue>;
	savedNotes?: Record<string, { label: string; notes: string }>;
	savedFinalNotes?: string;
}

const DeckParams = Type.Object(
	{
		slides: Type.Optional(
			Type.String({
				description:
					"JSON string of deck config. Each slide has id, title, context?, columns? (1|2|3, omit for auto-layout), multiSelect? (boolean, enables checkbox selection + Select All), and options[]. " +
					"Each option has label, description?, aside?, recommended?, and either previewHtml (raw HTML string) or " +
					"previewBlocks (array of typed blocks: {type:'html',content}, {type:'mermaid',content,theme?}, " +
					"{type:'code',code,lang}, {type:'image',src,alt,caption?}). Exactly one of previewHtml or previewBlocks required per option. " +
					"When multiSelect is true, users can select multiple options or use 'Select All'. Selections are returned as arrays.",
			})
		),
		action: Type.Optional(
			Type.Union([
				Type.Literal("add-option", { description: "Push a single generated option into a running deck session" }),
				Type.Literal("add-options", { description: "Push multiple generated options into a running deck session (blocks until next user action)" }),
				Type.Literal("replace-options", { description: "Replace all options for a slide with fresh alternatives" }),
				Type.Literal("list", { description: "List saved decks from the snapshot directory" }),
				Type.Literal("open", { description: "Open a saved deck by deck ID" }),
				Type.Literal("export", { description: "Export a saved deck as standalone HTML" }),
			])
		),
		slideId: Type.Optional(
			Type.String({ description: "Target slide ID (required with action: 'add-option', 'add-options', or 'replace-options')" })
		),
		option: Type.Optional(
			Type.String({
				description:
					"JSON string of one deck option with label and either previewHtml or previewBlocks (required with action: 'add-option')",
			})
		),
		options: Type.Optional(
			Type.String({
				description:
					"JSON string of array of deck options (required with action: 'add-options' or 'replace-options')",
			})
		),
		deckId: Type.Optional(
			Type.String({ description: "Deck ID for open/export actions (folder name from list)" })
		),
		format: Type.Optional(
			Type.String({ description: "Export format: 'html' (default)" })
		),
	},
	{ additionalProperties: false }
);

function expandHome(value: string): string {
	if (value === "~") {
		return os.homedir();
	}
	// Handle both Unix (/) and Windows (\) separators for user convenience
	if (value.startsWith("~/") || value.startsWith("~\\")) {
		return path.join(os.homedir(), value.slice(2));
	}
	return value;
}

function resolveSnapshotDir(snapshotDir?: string): string {
	return snapshotDir ? expandHome(snapshotDir) : getDefaultSnapshotDir();
}

function listSavedDecks(snapshotDir: string): { decks: SavedDeckListItem[]; warnings: string[] } {
	if (!fs.existsSync(snapshotDir)) {
		return { decks: [], warnings: [] };
	}

	const entries = fs.readdirSync(snapshotDir, { withFileTypes: true });
	const decks: SavedDeckListItem[] = [];
	const warnings: string[] = [];

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const deckJsonPath = path.join(snapshotDir, entry.name, "deck.json");
		if (!fs.existsSync(deckJsonPath)) continue;

		try {
			const raw = JSON.parse(fs.readFileSync(deckJsonPath, "utf-8"));
			const saved = validateSavedDeck(raw);
			decks.push({
				id: saved.id ?? entry.name,
				title: saved.config.title || "Design Deck",
				savedAt: saved.savedAt,
				modifiedAt: saved.modifiedAt ?? saved.savedAt,
				status: saved.status ?? deriveDeckStatusFromFolderName(entry.name),
				cwd: saved.savedFrom?.cwd,
				branch: saved.savedFrom?.branch,
				slideCount: saved.config.slides.length,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			warnings.push(`${entry.name}: ${message}`);
		}
	}

	return { decks, warnings };
}

function resolveDeckFilePath(snapshotDir: string, deckId: string): string | null {
	if (!deckId || deckId === "." || deckId === ".." || deckId.includes("/") || deckId.includes("\\")) {
		return null;
	}
	const root = path.resolve(snapshotDir);
	const deckDir = path.resolve(snapshotDir, deckId);
	if (deckDir !== root && !deckDir.startsWith(root + path.sep)) {
		return null;
	}
	return path.join(deckDir, "deck.json");
}

function buildSavedNotesForClient(saved: SavedDeckData): Record<string, { label: string; notes: string }> | undefined {
	const savedNotesForClient: Record<string, { label: string; notes: string }> = {};
	for (const [slideId, noteString] of Object.entries(saved.notes ?? {})) {
		const selection = saved.selections[slideId];
		// For multi-select, use the first selected label for note association
		const label = Array.isArray(selection) ? selection[0] : selection;
		if (label && noteString) {
			savedNotesForClient[slideId] = { label, notes: noteString };
		}
	}
	return Object.keys(savedNotesForClient).length > 0 ? savedNotesForClient : undefined;
}

function loadDeckFile(absolutePath: string): LoadedDeckSource {
	const content = fs.readFileSync(absolutePath, "utf-8");
	let fileData: unknown;
	try {
		fileData = JSON.parse(content);
	} catch (parseErr) {
		const message = parseErr instanceof Error ? parseErr.message : String(parseErr);
		throw new Error(`Invalid JSON in saved deck file: ${message}`);
	}

	const raw = fileData as Record<string, unknown>;
	if (raw.config && typeof raw.config === "object") {
		const saved = validateSavedDeck(fileData);
		const snapshotDir = path.dirname(absolutePath);
		for (const slide of saved.config.slides) {
			for (const option of slide.options) {
				if (!option.previewBlocks) continue;
				for (const block of option.previewBlocks) {
					if (block.type === "image" && !path.isAbsolute(block.src)) {
						block.src = path.join(snapshotDir, block.src);
					}
				}
			}
		}
		return {
			configData: saved.config,
			savedSelections: Object.keys(saved.selections).length > 0 ? saved.selections : undefined,
			savedNotes: buildSavedNotesForClient(saved),
			savedFinalNotes: saved.finalNotes,
		};
	}

	return { configData: fileData };
}

const DEFAULT_THEME_HOTKEY = "mod+shift+l";

function clearDeckIdleTimer(): void {
	if (activeDeckIdleTimer) {
		clearTimeout(activeDeckIdleTimer);
		activeDeckIdleTimer = null;
	}
}

function cleanupActiveDeck(reason?: string): void {
	clearDeckIdleTimer();
	if (restoreDeckThinking) {
		restoreDeckThinking();
		restoreDeckThinking = null;
	}
	if (!activeDeckServer) return;
	try {
		activeDeckServer.handle.close(reason);
	} catch {}
	activeDeckServer = null;
}

function cleanupActiveDeckAndStoreResult(result: DeckToolResult): void {
	if (!activeDeckServer) return;
	// Extract close reason from result details
	const details = result.details as DeckDetails | undefined;
	const closeReason = details?.status === "aborted" ? "aborted" : details?.reason;
	if (activeDeckServer.currentResolve) {
		const resolve = activeDeckServer.currentResolve;
		cleanupActiveDeck(closeReason);
		resolve(result);
	} else {
		pendingDeckResult = result;
		cleanupActiveDeck(closeReason);
	}
}

function armDeckIdleTimer(): void {
	clearDeckIdleTimer();
	activeDeckIdleTimer = setTimeout(() => {
		if (!activeDeckServer) return;
		const url = activeDeckServer.handle.url;
		cleanupActiveDeckAndStoreResult({
			content: [{ type: "text", text: "Design deck closed after 5 minutes of inactivity." }],
			details: { status: "cancelled", url, reason: "idle-timeout" },
		});
	}, DECK_IDLE_TIMEOUT_MS);
}

function blockOnDeck(): Promise<DeckToolResult> {
	if (!activeDeckServer) {
		return Promise.resolve({
			content: [{ type: "text", text: "No active design deck session." }],
			details: { status: "error", url: "" },
		});
	}
	clearDeckIdleTimer();
	return new Promise((resolve) => {
		activeDeckServer!.currentResolve = resolve;
	});
}

function attachDeckAbortHandler(signal: AbortSignal | undefined): void {
	if (!signal) return;
	const abortHandler = () => {
		if (!activeDeckServer) return;
		const url = activeDeckServer.handle.url;
		cleanupActiveDeckAndStoreResult({
			content: [{ type: "text", text: "Design deck was aborted." }],
			details: { status: "aborted", url },
		});
	};
	signal.addEventListener("abort", abortHandler, { once: true });
}

function formatDeckSelections(selections: Record<string, SelectionValue>, notes?: Record<string, string>): string {
	const entries = Object.entries(selections);
	if (entries.length === 0) return "(none)";
	return entries.map(([key, value]) => {
		const displayValue = Array.isArray(value) ? value.join(", ") : value;
		const note = notes?.[key];
		if (note) {
			return `- ${key}: ${displayValue}\n  Notes: ${note}`;
		}
		return `- ${key}: ${displayValue}`;
	}).join("\n");
}

export default function (pi: ExtensionAPI) {

	pi.registerTool({
		name: "design_deck",
		label: "Design Deck",
		description:
			"Present a multi-slide design deck with visual options for decisions. " +
			"Slides JSON: { title?, slides: [{ id, title, context?, columns?, options }] }. " +
			"When the user requests more options, tool returns generate-more instructions — " +
			'call design_deck with action:"add-options" to push all new options at once. ' +
			"previewBlocks for code/architecture comparisons, previewHtml for custom UI mockups.",
		parameters: DeckParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const p = params as Record<string, unknown>;

			if (!ctx.hasUI && p.action !== "list" && p.action !== "export") {
				throw new Error(
					"design_deck requires interactive mode with browser support. " +
						"Cannot run in headless/RPC/print mode."
				);
			}

			if (p.action === "list") {
				const settings = loadSettings();
				const snapshotDir = resolveSnapshotDir(settings.snapshotDir);
				const { decks, warnings } = listSavedDecks(snapshotDir);
				const content: Array<{ type: "text"; text: string }> = [
					{ type: "text", text: JSON.stringify(decks, null, 2) },
				];
				if (warnings.length > 0) {
					content.push({ type: "text", text: `Warnings:\n${warnings.map((w) => `- ${w}`).join("\n")}` });
				}
				return { content };
			}

			if (p.action === "add-option") {
				if (typeof p.slideId !== "string" || p.slideId.trim() === "") {
					activeDeckServer?.handle.cancelGenerate();
					return {
						content: [{ type: "text", text: 'add-option requires slideId (string). Example: { action: "add-option", slideId: "arch", option: "<JSON string>" }' }],
						details: { status: "error", url: activeDeckServer?.handle.url ?? "" },
					};
				}
				if (typeof p.option !== "string" || p.option.trim() === "") {
					activeDeckServer?.handle.cancelGenerate();
					return {
						content: [{ type: "text", text: 'add-option requires option (JSON string with label and either previewHtml or previewBlocks).' }],
						details: { status: "error", url: activeDeckServer?.handle.url ?? "" },
					};
				}
			} else if (p.action === "add-options") {
				if (typeof p.slideId !== "string" || p.slideId.trim() === "") {
					activeDeckServer?.handle.cancelGenerate();
					return {
						content: [{ type: "text", text: 'add-options requires slideId (string).' }],
						details: { status: "error", url: activeDeckServer?.handle.url ?? "" },
					};
				}
				if (typeof p.options !== "string" || p.options.trim() === "") {
					activeDeckServer?.handle.cancelGenerate();
					return {
						content: [{ type: "text", text: 'add-options requires options (JSON array string).' }],
						details: { status: "error", url: activeDeckServer?.handle.url ?? "" },
					};
				}
			} else if (p.action === "replace-options") {
				if (typeof p.slideId !== "string" || p.slideId.trim() === "") {
					activeDeckServer?.handle.cancelGenerate();
					return {
						content: [{ type: "text", text: 'replace-options requires slideId (string).' }],
						details: { status: "error", url: activeDeckServer?.handle.url ?? "" },
					};
				}
				if (typeof p.options !== "string" || p.options.trim() === "") {
					activeDeckServer?.handle.cancelGenerate();
					return {
						content: [{ type: "text", text: 'replace-options requires options (JSON array string).' }],
						details: { status: "error", url: activeDeckServer?.handle.url ?? "" },
					};
				}
			} else if (p.action === "open" || p.action === "export") {
				if (typeof p.deckId !== "string" || p.deckId.trim() === "") {
					return {
						content: [{ type: "text", text: `${p.action} requires deckId (string). Example: { action: "${p.action}", deckId: "tabs-component-myapp-main-2026-03-01-103045-submitted" }` }],
						details: { status: "error", url: activeDeckServer?.handle.url ?? "" },
					};
				}
			} else if (typeof p.slides !== "string" || p.slides.trim() === "") {
				return {
					content: [{
						type: "text",
						text:
							"design_deck requires one of:\n\n" +
							'1. Start a new deck: { slides: "<JSON string of { title?, slides: [{ id, title, options }] }>" }\n' +
							'2. Open a saved deck: { action: "open", deckId: "..." }\n' +
							'3. Export a saved deck: { action: "export", deckId: "...", format: "html" }\n' +
							'4. Add options to running deck: { action: "add-options", slideId: "...", options: "[<JSON array>]" }\n' +
							'5. Add single option: { action: "add-option", slideId: "...", option: "<JSON string>" }\n\n' +
							"Each option needs label + either previewHtml (raw HTML) or previewBlocks (array of {type, ...} blocks).\n" +
							"Block types: html, mermaid, code, image.",
					}],
					details: { status: "error", url: "" },
				};
			}

			if (p.action === "add-option") {
				if (pendingDeckResult) {
					const result = pendingDeckResult;
					pendingDeckResult = null;
					return result;
				}

				if (!activeDeckServer) {
					return {
						content: [
							{
								type: "text",
								text: "No active design deck session. Start a new deck before adding options.",
							},
						],
						details: { status: "error", url: "" },
					};
				}

				// Note: We don't check currentResolve here because multiple parallel
				// add-option calls are valid (e.g., user requests 3 options at once)

				const slideId = p.slideId as string;
				const option = p.option as string;

				let parsedOption: unknown;
				try {
					parsedOption = JSON.parse(option);
				} catch (err) {
					activeDeckServer.handle.cancelGenerate();
					const message = err instanceof Error ? err.message : String(err);
					const snippet = option.length > 300 ? option.slice(0, 300) + "..." : option;
					return {
						content: [{ type: "text", text: `Invalid option JSON: ${message}\n\nReceived:\n${snippet}\n\nFix the JSON and call design_deck add-option again.` }],
						details: { status: "error", url: activeDeckServer.handle.url },
					};
				}

				if (!isDeckOption(parsedOption)) {
					activeDeckServer.handle.cancelGenerate();
					return {
						content: [{ type: "text", text: "Option is invalid — needs label (string) and either previewHtml (non-empty string) or previewBlocks (non-empty array). Fix and call design_deck add-option again." }],
						details: { status: "error", url: activeDeckServer.handle.url },
					};
				}

				try {
					activeDeckServer.handle.pushOption(slideId, parsedOption);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					return {
						content: [{ type: "text", text: `Failed to push option: ${message}` }],
						details: { status: "error", url: activeDeckServer.handle.url },
					};
				}

				// For add-option, return immediately without blocking.
				// This allows parallel add-option calls to all succeed.
				// The deck stays open and will send a new prompt when the user
				// clicks generate-more again or submits.
				return {
					content: [{ type: "text", text: `Pushed option "${parsedOption.label}" to slide ${slideId}.` }],
					details: { status: "generate-more", url: activeDeckServer.handle.url, slideId },
				};
			}

			if (p.action === "add-options") {
				if (pendingDeckResult) {
					const result = pendingDeckResult;
					pendingDeckResult = null;
					return result;
				}

				if (!activeDeckServer) {
					return {
						content: [{ type: "text", text: "No active design deck session. Start a new deck before adding options." }],
						details: { status: "error", url: "" },
					};
				}

				if (activeDeckServer.currentResolve !== null) {
					return {
						content: [{ type: "text", text: "Design deck is not waiting for new options right now." }],
						details: { status: "error", url: activeDeckServer.handle.url },
					};
				}

				const slideId = p.slideId as string;
				const optionsStr = p.options as string;

				let parsedOptions: unknown;
				try {
					parsedOptions = JSON.parse(optionsStr);
				} catch (err) {
					activeDeckServer.handle.cancelGenerate();
					const message = err instanceof Error ? err.message : String(err);
					const snippet = optionsStr.length > 300 ? optionsStr.slice(0, 300) + "..." : optionsStr;
					return {
						content: [{ type: "text", text: `Invalid options JSON: ${message}\n\nReceived:\n${snippet}\n\nFix the JSON and call design_deck add-options again.` }],
						details: { status: "error", url: activeDeckServer.handle.url },
					};
				}

				if (!Array.isArray(parsedOptions)) {
					activeDeckServer.handle.cancelGenerate();
					return {
						content: [{ type: "text", text: "options must be a JSON array of deck options. Fix and call design_deck add-options again." }],
						details: { status: "error", url: activeDeckServer.handle.url },
					};
				}

				for (const opt of parsedOptions) {
					if (!isDeckOption(opt)) {
						activeDeckServer.handle.cancelGenerate();
						return {
							content: [{ type: "text", text: "One or more options in the array are invalid — each needs label and either previewHtml or previewBlocks. Fix and call design_deck add-options again." }],
							details: { status: "error", url: activeDeckServer.handle.url },
						};
					}
				}

				try {
					for (const opt of parsedOptions) {
						activeDeckServer.handle.pushOption(slideId, opt);
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					return {
						content: [{ type: "text", text: `Failed to push options: ${message}` }],
						details: { status: "error", url: activeDeckServer.handle.url },
					};
				}

				if (onUpdate) {
					onUpdate({
						content: [{ type: "text", text: `Pushed ${parsedOptions.length} options to slide ${slideId}.` }],
						details: { status: "generate-more", url: activeDeckServer.handle.url, slideId },
					});
				}
				attachDeckAbortHandler(signal);
				return blockOnDeck();
			}

			if (p.action === "replace-options") {
				if (pendingDeckResult) {
					const result = pendingDeckResult;
					pendingDeckResult = null;
					return result;
				}

				if (!activeDeckServer) {
					return {
						content: [{ type: "text", text: "No active design deck session. Start a new deck before replacing options." }],
						details: { status: "error", url: "" },
					};
				}

				if (activeDeckServer.currentResolve !== null) {
					return {
						content: [{ type: "text", text: "Design deck is not waiting for regenerated options right now." }],
						details: { status: "error", url: activeDeckServer.handle.url },
					};
				}

				const slideId = p.slideId as string;
				const optionsStr = p.options as string;

				let parsedOptions: unknown;
				try {
					parsedOptions = JSON.parse(optionsStr);
				} catch (err) {
					activeDeckServer.handle.cancelGenerate();
					const message = err instanceof Error ? err.message : String(err);
					const snippet = optionsStr.length > 300 ? optionsStr.slice(0, 300) + "..." : optionsStr;
					return {
						content: [{ type: "text", text: `Invalid options JSON: ${message}\n\nReceived:\n${snippet}\n\nFix the JSON and call design_deck replace-options again.` }],
						details: { status: "error", url: activeDeckServer.handle.url },
					};
				}

				if (!Array.isArray(parsedOptions)) {
					activeDeckServer.handle.cancelGenerate();
					return {
						content: [{ type: "text", text: "options must be a JSON array of deck options. Fix and call design_deck replace-options again." }],
						details: { status: "error", url: activeDeckServer.handle.url },
					};
				}

				for (const opt of parsedOptions) {
					if (!isDeckOption(opt)) {
						activeDeckServer.handle.cancelGenerate();
						return {
							content: [{ type: "text", text: "One or more options in the array are invalid — each needs label and either previewHtml or previewBlocks. Fix and call design_deck replace-options again." }],
							details: { status: "error", url: activeDeckServer.handle.url },
						};
					}
				}

				try {
					activeDeckServer.handle.replaceSlideOptions(slideId, parsedOptions);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					return {
						content: [{ type: "text", text: `Failed to replace options: ${message}` }],
						details: { status: "error", url: activeDeckServer.handle.url },
					};
				}

				if (onUpdate) {
					onUpdate({
						content: [{ type: "text", text: `Replaced ${parsedOptions.length} options for slide ${slideId}.` }],
						details: { status: "generate-more", url: activeDeckServer.handle.url, slideId },
					});
				}
				attachDeckAbortHandler(signal);
				return blockOnDeck();
			}

			pendingDeckResult = null;

			if (activeDeckServer && p.action !== "export") {
				return {
					content: [
						{
							type: "text",
							text: "A design deck is already active. Complete or cancel it before starting another.",
						},
					],
					details: { status: "error", url: activeDeckServer.handle.url },
				};
			}

			const settings = loadSettings();
			const snapshotDir = resolveSnapshotDir(settings.snapshotDir);
			let slides = p.slides as string;
			if (p.action === "open" || p.action === "export") {
				const deckId = (p.deckId as string).trim();
				const deckPath = resolveDeckFilePath(snapshotDir, deckId);
				if (!deckPath || !fs.existsSync(deckPath)) {
					const { decks } = listSavedDecks(snapshotDir);
					const availableHint = decks.length > 0
						? ` Available deck IDs: ${decks.slice(0, 10).map((deck) => deck.id).join(", ")}`
						: " Snapshot directory is empty.";
					return {
						content: [{ type: "text", text: `Saved deck "${deckId}" not found in ${snapshotDir}.${availableHint}` }],
						details: { status: "error", url: "" },
					};
				}
				if (p.action === "export") {
					const format = typeof p.format === "string" && p.format.trim() !== "" ? p.format.trim().toLowerCase() : "html";
					if (format !== "html") {
						return {
							content: [{ type: "text", text: `Unsupported export format: ${format}` }],
							details: { status: "error", url: "" },
						};
					}
					try {
						const saved = validateSavedDeck(JSON.parse(fs.readFileSync(deckPath, "utf-8")));
						const enrichedSaved: SavedDeckData = {
							...saved,
							id: saved.id ?? deckId,
							status: saved.status ?? deriveDeckStatusFromFolderName(deckId),
						};
						const html = buildStandaloneDeckHtml(deckPath, enrichedSaved);
						const exportPath = path.join(path.dirname(deckPath), "export.html");
						fs.writeFileSync(exportPath, html, "utf-8");
						const relativePath = exportPath.startsWith(os.homedir())
							? "~" + exportPath.slice(os.homedir().length)
							: exportPath;
						return {
							content: [{ type: "text", text: `Exported HTML to ${relativePath}` }],
						};
					} catch (err) {
						const message = err instanceof Error ? err.message : String(err);
						return {
							content: [{ type: "text", text: `Failed to export deck "${deckId}": ${message}` }],
							details: { status: "error", url: "" },
						};
					}
				}
				slides = deckPath;
			}

			let configData: unknown;
			let savedSelections: Record<string, SelectionValue> | undefined;
			let savedNotes: Record<string, { label: string; notes: string }> | undefined;
			let savedFinalNotes: string | undefined;
			try {
				configData = JSON.parse(slides);
			} catch {
				const expanded = expandHome(slides);
				const absolutePath = path.isAbsolute(expanded) ? expanded : path.join(ctx.cwd, slides);
				if (!fs.existsSync(absolutePath)) {
					throw new Error(`Invalid slides: not valid JSON and file not found at ${absolutePath}`);
				}
				const loaded = loadDeckFile(absolutePath);
				configData = loaded.configData;
				savedSelections = loaded.savedSelections;
				savedNotes = loaded.savedNotes;
				savedFinalNotes = loaded.savedFinalNotes;
			}
			const config = validateDeckConfig(configData);
			const sessionId = randomUUID();
			const sessionToken = randomUUID();

			if (signal?.aborted) {
				return {
					content: [{ type: "text", text: "Design deck was aborted." }],
					details: { status: "aborted", url: "" },
				};
			}

			const handleSubmit = (selections: Record<string, SelectionValue>, notes?: Record<string, string>, finalNotes?: string) => {
				if (!activeDeckServer) return;
				const url = activeDeckServer.handle.url;
				const hasNotes = notes && Object.keys(notes).length > 0;
				const textParts = [`Design deck completed.\n\nSelections:\n${formatDeckSelections(selections, notes)}`];
				if (finalNotes) {
					textParts.push(`\nAdditional instructions:\n${finalNotes}`);
				}
				cleanupActiveDeckAndStoreResult({
					content: [
						{
							type: "text",
							text: textParts.join(""),
						},
					],
					details: { 
						status: "completed", 
						url, 
						selections, 
						...(hasNotes ? { notes } : {}),
						...(finalNotes ? { finalNotes } : {}),
					},
				});
			};

			const handleCancel = (reason?: "user" | "stale" | "aborted") => {
				if (!activeDeckServer) return;
				const url = activeDeckServer.handle.url;
				cleanupActiveDeckAndStoreResult({
					content: [
						{
							type: "text",
							text:
								reason === "stale"
									? "Design deck session ended due to lost heartbeat."
									: "Design deck was cancelled.",
						},
					],
					details: { status: "cancelled", url, reason },
				});
			};

			const handleGenerateMore = (slideId: string, prompt?: string, model?: string, thinking?: string, count?: number) => {
				if (!activeDeckServer?.currentResolve) {
					// Agent is no longer listening - close the deck
					cleanupActiveDeck("stale");
					return;
				}
				const resolve = activeDeckServer.currentResolve;
				activeDeckServer.currentResolve = null;
				armDeckIdleTimer();
				const slide = config.slides.find((s) => s.id === slideId);
				const effectiveModel = model === undefined ? loadSettings().generateModel : (model || undefined);
				if (thinking && !effectiveModel) {
					pi.setThinkingLevel(thinking as "off" | "minimal" | "low" | "medium" | "high" | "xhigh");
				}
				const effectiveCount = count && count >= 1 && count <= 5 ? count : 1;
				resolve({
					content: [{ type: "text", text: buildGenerateMoreResult(slideId, slide, prompt, effectiveModel, thinking, effectiveCount) }],
					details: {
						status: "generate-more",
						url: activeDeckServer.handle.url,
						slideId,
					},
				});
			};

			const handleRegenerateSlide = (slideId: string, prompt?: string, model?: string, thinking?: string) => {
				if (!activeDeckServer?.currentResolve) {
					// Agent is no longer listening - close the deck
					cleanupActiveDeck("stale");
					return;
				}
				const resolve = activeDeckServer.currentResolve;
				activeDeckServer.currentResolve = null;
				armDeckIdleTimer();
				const slide = config.slides.find((s) => s.id === slideId);
				const optionCount = slide?.options?.length || 2;
				const effectiveModel = model === undefined ? loadSettings().generateModel : (model || undefined);
				if (thinking && !effectiveModel) {
					pi.setThinkingLevel(thinking as "off" | "minimal" | "low" | "medium" | "high" | "xhigh");
				}
				resolve({
					content: [{ type: "text", text: buildRegenerateResult(slideId, slide, optionCount, prompt, effectiveModel, thinking) }],
					details: {
						status: "generate-more",
						url: activeDeckServer.handle.url,
						slideId,
					},
				});
			};

			const themeConfig = settings.theme ?? {};
			const currentModelStr = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null;
			const availableModels: ModelInfo[] = ctx.modelRegistry.getAvailable().map((m) => ({
				provider: m.provider,
				id: m.id,
				name: m.name,
				reasoning: m.reasoning,
			}));

			const originalThinking = pi.getThinkingLevel();
			restoreDeckThinking = () => pi.setThinkingLevel(originalThinking);

			const serverHandle = await startDeckServer(
				{
					config,
					sessionToken,
					sessionId,
					cwd: ctx.cwd,
					port: settings.port,
					theme: {
						mode: themeConfig.mode ?? "dark",
						toggleHotkey: themeConfig.toggleHotkey ?? DEFAULT_THEME_HOTKEY,
					},
					savedSelections,
					savedNotes,
					savedFinalNotes,
					snapshotDir,
					autoSaveOnSubmit: settings.autoSaveOnSubmit ?? true,
					models: {
						current: currentModelStr,
						available: availableModels,
						defaultModel: settings.generateModel ?? null,
						currentThinking: originalThinking,
						currentModelReasoning: ctx.model?.reasoning ?? false,
					},
				},
				{
					onSubmit: handleSubmit,
					onCancel: handleCancel,
					onGenerateMore: handleGenerateMore,
					onRegenerateSlide: handleRegenerateSlide,
				}
			);

			activeDeckServer = { handle: serverHandle, currentResolve: null };
			attachDeckAbortHandler(signal);

			if (onUpdate) {
				onUpdate({
					content: [{ type: "text", text: "Design deck server started." }],
					details: { status: "generate-more", url: serverHandle.url },
				});
			}

			try {
				await openUrl(pi, serverHandle.url, settings.browser);
			} catch (err) {
				cleanupActiveDeck();
				const message = err instanceof Error ? err.message : String(err);
				throw new Error(`Failed to open browser: ${message}`);
			}

			return blockOnDeck();
		},

		renderCall(args, theme) {
			const data = args as { action?: string; slideId?: string; slides?: string };
			if (data.action === "add-option") {
				return new Text(
					theme.fg("toolTitle", theme.bold(`Design Deck: add option (${data.slideId || "unknown"})`)),
					0,
					0
				);
			}
			if (data.action === "add-options") {
				return new Text(
					theme.fg("toolTitle", theme.bold(`Design Deck: add options (${data.slideId || "unknown"})`)),
					0,
					0
				);
			}
			if (data.action === "replace-options") {
				return new Text(
					theme.fg("toolTitle", theme.bold(`Design Deck: replace options (${data.slideId || "unknown"})`)),
					0,
					0
				);
			}
			if (typeof data.slides === "string" && data.slides.trim()) {
				try {
					const parsed = JSON.parse(data.slides) as { slides?: unknown[] };
					if (Array.isArray(parsed.slides)) {
						return new Text(theme.fg("toolTitle", theme.bold(`Design Deck: ${parsed.slides.length} slides`)), 0, 0);
					}
				} catch {
					// JSON incomplete during streaming - fall through
				}
			}
			return new Text(theme.fg("toolTitle", theme.bold("Design Deck")), 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as DeckDetails | undefined;
			if (!details) return new Text("Design Deck", 0, 0);

			if (details.status === "generate-more") {
				const slide = details.slideId ? ` (${details.slideId})` : "";
				return new Text(theme.fg("warning", `GENERATE-MORE${slide}`), 0, 0);
			}

			if (details.status === "completed") {
				const count = details.selections ? Object.keys(details.selections).length : 0;
				return new Text(theme.fg("success", `COMPLETED (${count} selections)`), 0, 0);
			}

			if (details.status === "cancelled") {
				const reason = details.reason ? ` (${details.reason})` : "";
				return new Text(theme.fg("warning", `CANCELLED${reason}`), 0, 0);
			}

			if (details.status === "aborted") {
				return new Text(theme.fg("error", "ABORTED"), 0, 0);
			}

			return new Text(theme.fg("error", "ERROR"), 0, 0);
		},
	});

	pi.registerTool({
		name: "deck_generate",
		description: "Generate text using a specific model (for design deck option generation). Use this when the generate-more prompt specifies a model override.",
		parameters: Type.Object({
			model: Type.String({ description: "Full model ID in 'provider/model-id' format (e.g., 'anthropic/claude-haiku-4-5')" }),
			task: Type.String({ description: "The generation task/prompt" }),
		}),
		async execute(_toolCallId, params) {
			const { model, task } = params as { model: string; task: string };
			try {
				const result = await generateWithModel(model, task);
				return { content: [{ type: "text", text: result }] };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return { content: [{ type: "text", text: `Generation failed: ${message}` }], isError: true };
			}
		},
	});

	pi.on("session_shutdown", () => {
		pendingDeckResult = null;
		cleanupActiveDeck();
	});
}
