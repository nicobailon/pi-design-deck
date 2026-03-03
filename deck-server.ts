import http from "node:http";
import { basename, dirname, extname, join, resolve } from "node:path";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import {
	getGitBranch,
	MAX_BODY_SIZE,
	normalizePath,
	registerSession,
	safeInlineJSON,
	safeParseBody,
	sendJson,
	sendText,
	touchSession,
	unregisterSession,
	validateTokenBody,
	validateTokenQuery,
	type SessionEntry,
} from "./server-utils.js";
import { isDeckOption, type DeckConfig, type DeckOption, type PreviewBlock, type SelectionValue } from "./deck-schema.js";
import { saveGenerateModel } from "./settings.js";

export interface ModelInfo {
	provider: string;
	id: string;
	name: string;
	reasoning: boolean;
}

export interface ModelsPayload {
	current: string | null;
	available: ModelInfo[];
	defaultModel: string | null;
	currentThinking: string;
	currentModelReasoning: boolean;
}

const FORM_DIR = join(dirname(fileURLToPath(import.meta.url)), "form");
const DECK_TEMPLATE = readFileSync(join(FORM_DIR, "deck.html"), "utf-8");

// CSS modules - concatenated in order
const CSS_FILES = ["variables", "layout", "preview", "controls"];
const DECK_CSS = CSS_FILES
	.map((name) => readFileSync(join(FORM_DIR, "css", `${name}.css`), "utf-8"))
	.join("\n");

// JS modules - concatenated in order (core first, session last with init())
const JS_FILES = ["deck-core", "deck-render", "deck-interact", "deck-session"];
const DECK_JS = JS_FILES
	.map((name) => readFileSync(join(FORM_DIR, "js", `${name}.js`), "utf-8"))
	.join("\n");

const MIME_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".avif": "image/avif",
};

const ABANDONED_GRACE_MS = 60000;
const WATCHDOG_INTERVAL_MS = 5000;
const GENERATE_TIMEOUT_MS = 90_000;

export function getDefaultSnapshotDir(): string {
	return join(homedir(), ".pi", "deck-snapshots");
}

function toStringMap(value: unknown): Record<string, string> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const out: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		if (typeof entry !== "string") return null;
		out[key] = entry;
	}
	return out;
}

function toSelectionsMap(value: unknown): Record<string, SelectionValue> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const out: Record<string, SelectionValue> = {};
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		if (typeof entry === "string") {
			out[key] = entry;
		} else if (Array.isArray(entry) && entry.every((v) => typeof v === "string")) {
			out[key] = entry as string[];
		} else {
			return null;
		}
	}
	return out;
}

function registerAsset(filePath: string, assetsDir: string): string {
	if (!existsSync(filePath)) throw new Error(`Image not found: ${filePath}`);
	const ext = extname(filePath);
	const id = randomUUID();
	const dest = join(assetsDir, `${id}${ext}`);
	copyFileSync(filePath, dest);
	return `/assets/${id}${ext}`;
}

function processImageBlocks(blocks: PreviewBlock[], assetsDir: string): PreviewBlock[] {
	return blocks.map((block) => {
		if (block.type !== "image") return block;
		const servedSrc = registerAsset(block.src, assetsDir);
		return { ...block, src: servedSrc };
	});
}

function processOptionAssets(option: DeckOption, assetsDir: string): DeckOption {
	if (!option.previewBlocks) return option;
	return { ...option, previewBlocks: processImageBlocks(option.previewBlocks, assetsDir) };
}

const DECK_SNAPSHOTS_DIR = getDefaultSnapshotDir();

function sanitizeForFilename(value: string): string {
	return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40).replace(/_+$/, "") || "unknown";
}

function saveDeckSnapshot(
	config: DeckConfig,
	selections: Record<string, SelectionValue>,
	assetsDir: string,
	normalizedCwd: string,
	gitBranch: string | null,
	sessionId: string,
	baseDir: string,
	options?: {
		status?: "submitted" | "in-progress" | "cancelled";
		notes?: Record<string, string>;
		finalNotes?: string;
	}
): { path: string; relativePath: string } {
	const now = new Date();
	const nowIso = now.toISOString();
	const date = now.toISOString().slice(0, 10);
	const time = now.toTimeString().slice(0, 8).replace(/:/g, "");
	const titleSlug = sanitizeForFilename(config.title || "deck");
	const project = sanitizeForFilename(basename(normalizedCwd) || "unknown");
	const branch = sanitizeForFilename(gitBranch || "nogit");
	const suffix = options?.status === "submitted" || options?.status === "cancelled" ? options.status : undefined;
	const safeSuffix = suffix ? `-${suffix}` : "";
	const baseFolderName = `${titleSlug}-${project}-${branch}-${date}-${time}${safeSuffix}`;
	let folderName = baseFolderName;
	let snapshotPath = join(baseDir, folderName);
	let collisionIndex = 2;
	while (existsSync(snapshotPath)) {
		folderName = `${baseFolderName}-${collisionIndex}`;
		snapshotPath = join(baseDir, folderName);
		collisionIndex += 1;
	}
	const imagesPath = join(snapshotPath, "images");

	mkdirSync(snapshotPath, { recursive: true });

	const saved = structuredClone(config);
	for (const slide of saved.slides) {
		for (const option of slide.options) {
			if (!option.previewBlocks) continue;
			for (const block of option.previewBlocks) {
				if (block.type !== "image" || !block.src.startsWith("/assets/")) continue;
				const filename = block.src.slice("/assets/".length);
				const srcFile = join(assetsDir, filename);
				if (existsSync(srcFile)) {
					mkdirSync(imagesPath, { recursive: true });
					copyFileSync(srcFile, join(imagesPath, filename));
					(block as { src: string }).src = `images/${filename}`;
				}
			}
		}
	}

	const data = {
		config: saved,
		selections,
		savedAt: nowIso,
		id: folderName,
		status: options?.status,
		modifiedAt: nowIso,
		notes: options?.notes && Object.keys(options.notes).length > 0 ? options.notes : undefined,
		finalNotes: options?.finalNotes ? options.finalNotes : undefined,
		savedFrom: { cwd: normalizedCwd, branch: gitBranch, sessionId },
	};
	writeFileSync(join(snapshotPath, "deck.json"), JSON.stringify(data, null, 2));

	const home = homedir();
	const relativePath = snapshotPath.startsWith(home) ? "~" + snapshotPath.slice(home.length) : snapshotPath;
	return { path: snapshotPath, relativePath };
}

export interface DeckServerOptions {
	config: DeckConfig;
	sessionToken: string;
	sessionId: string;
	cwd: string;
	port?: number;
	theme?: { mode?: string; toggleHotkey?: string };
	savedSelections?: Record<string, SelectionValue>;
	savedNotes?: Record<string, { label: string; notes: string }>;
	savedFinalNotes?: string;
	snapshotDir?: string;
	autoSaveOnSubmit?: boolean;
	models?: ModelsPayload;
}

export interface DeckServerCallbacks {
	onSubmit: (selections: Record<string, SelectionValue>, notes?: Record<string, string>, finalNotes?: string) => void;
	onCancel: (reason?: "user" | "stale" | "aborted") => void;
	onGenerateMore: (slideId: string, prompt?: string, model?: string, thinking?: string, count?: number) => void;
	onRegenerateSlide: (slideId: string, prompt?: string, model?: string, thinking?: string) => void;
}

export interface DeckServerHandle {
	url: string;
	port: number;
	close: (reason?: string) => void;
	pushOption: (slideId: string, option: DeckOption) => void;
	cancelGenerate: () => void;
	replaceSlideOptions: (slideId: string, options: DeckOption[]) => void;
}

export async function startDeckServer(
	options: DeckServerOptions,
	callbacks: DeckServerCallbacks
): Promise<DeckServerHandle> {
	const {
		config,
		sessionToken,
		sessionId,
		cwd,
		port,
		theme,
		savedSelections,
		savedNotes,
		savedFinalNotes,
		snapshotDir,
		autoSaveOnSubmit,
	} = options;
	const normalizedCwd = normalizePath(cwd);
	const gitBranch = getGitBranch(cwd);

	const assetsDir = mkdtempSync(join(tmpdir(), "deck-assets-"));

	for (const slide of config.slides) {
		slide.options = slide.options.map((opt) => processOptionAssets(opt, assetsDir));
	}

	const knownSlideIds = new Set(config.slides.map((s) => s.id));

	const sseClients = new Set<http.ServerResponse>();
	let pendingGenerate: { slideId: string; isRegen: boolean; timer: NodeJS.Timeout } | null = null;

	const clearPendingGenerate = () => {
		if (pendingGenerate) {
			clearTimeout(pendingGenerate.timer);
			pendingGenerate = null;
		}
	};

	const setPendingGenerate = (slideId: string, isRegen: boolean) => {
		clearPendingGenerate();
		const timer = setTimeout(() => {
			if (!pendingGenerate || completed) return;
			const { slideId: sid, isRegen: regen } = pendingGenerate;
			pendingGenerate = null;
			pushEvent(regen ? "regenerate-failed" : "generate-failed", { slideId: sid, reason: "timeout" });
		}, GENERATE_TIMEOUT_MS);
		pendingGenerate = { slideId, isRegen, timer };
	};

	let completed = false;
	let browserConnected = false;
	let sessionEntry: SessionEntry | null = null;
	let watchdog: NodeJS.Timeout | null = null;
	let lastHeartbeatAt = Date.now();

	const stopWatchdog = () => {
		if (watchdog) {
			clearInterval(watchdog);
			watchdog = null;
		}
	};

	const markCompleted = () => {
		if (completed) return false;
		completed = true;
		stopWatchdog();
		clearPendingGenerate();
		return true;
	};

	const touchHeartbeat = () => {
		lastHeartbeatAt = Date.now();
		if (!browserConnected) {
			browserConnected = true;
		}
		if (sessionEntry) {
			touchSession(sessionEntry);
		}
	};

	const pushEvent = (name: string, payload: unknown) => {
		const encoded = JSON.stringify(payload);
		const chunk = `event: ${name}\ndata: ${encoded}\n\n`;
		for (const client of sseClients) {
			try {
				client.write(chunk);
			} catch {
				sseClients.delete(client);
			}
		}
	};

	const closeSSE = () => {
		for (const client of sseClients) {
			try {
				client.end();
			} catch {}
		}
		sseClients.clear();
	};

	const server = http.createServer(async (req, res) => {
		try {
			const method = req.method || "GET";
			const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

			if (method === "GET" && url.pathname === "/") {
				if (!validateTokenQuery(url, sessionToken, res)) return;
				touchHeartbeat();
				const inlineData = safeInlineJSON({
					config,
					sessionToken,
					sessionId,
					cwd: normalizedCwd,
					gitBranch,
					theme,
					savedSelections,
					savedNotes,
					savedFinalNotes,
				});
				const title = config.title ? `${config.title} — Design Deck` : "Design Deck";
				const html = DECK_TEMPLATE
					.replace("/* __DECK_DATA_PLACEHOLDER__ */", inlineData)
					.replace("<title>Design Deck</title>", `<title>${title.replace(/</g, "&lt;")}</title>`);
				res.writeHead(200, {
					"Content-Type": "text/html; charset=utf-8",
					"Cache-Control": "no-store",
				});
				res.end(html);
				return;
			}

			if (method === "GET" && url.pathname === "/deck.css") {
				res.writeHead(200, {
					"Content-Type": "text/css; charset=utf-8",
					"Cache-Control": "no-store",
				});
				res.end(DECK_CSS);
				return;
			}

			if (method === "GET" && url.pathname === "/deck.js") {
				res.writeHead(200, {
					"Content-Type": "application/javascript; charset=utf-8",
					"Cache-Control": "no-store",
				});
				res.end(DECK_JS);
				return;
			}

			if (method === "GET" && url.pathname.startsWith("/assets/")) {
				const filename = url.pathname.slice("/assets/".length);
				if (!filename || filename.includes("/") || filename.includes("..")) {
					sendText(res, 400, "Invalid asset path");
					return;
				}
				const filePath = resolve(assetsDir, filename);
				if (!filePath.startsWith(assetsDir)) {
					sendText(res, 403, "Forbidden");
					return;
				}
				if (!existsSync(filePath)) {
					sendText(res, 404, "Asset not found");
					return;
				}
				const ext = extname(filename).toLowerCase();
				const contentType = MIME_TYPES[ext] || "application/octet-stream";
				const data = readFileSync(filePath);
				res.writeHead(200, {
					"Content-Type": contentType,
					"Cache-Control": "public, max-age=86400",
					"Content-Length": data.length,
				});
				res.end(data);
				return;
			}

			if (method === "GET" && url.pathname === "/events") {
				if (!validateTokenQuery(url, sessionToken, res)) return;
				touchHeartbeat();
				res.writeHead(200, {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache, no-transform",
					Connection: "keep-alive",
					"X-Accel-Buffering": "no",
				});
				res.write(": connected\n\n");
				sseClients.add(res);
				req.on("close", () => {
					sseClients.delete(res);
				});
				return;
			}

			if (method === "GET" && url.pathname === "/health") {
				if (!validateTokenQuery(url, sessionToken, res)) return;
				sendJson(res, 200, { ok: true, maxBodySize: MAX_BODY_SIZE });
				return;
			}

			if (method === "GET" && url.pathname === "/models") {
				if (!validateTokenQuery(url, sessionToken, res)) return;
				sendJson(res, 200, options.models ?? { current: null, available: [], defaultModel: null, currentThinking: "off", currentModelReasoning: false });
				return;
			}

			if (method === "POST" && url.pathname === "/save-model-default") {
				const body = await safeParseBody(req, res);
				if (!body) return;
				if (!validateTokenBody(body, sessionToken, res)) return;
				const payload = body as { model?: string };
				const model = typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : null;
				try {
					saveGenerateModel(model);
					if (options.models) options.models.defaultModel = model;
					sendJson(res, 200, { ok: true });
				} catch {
					sendJson(res, 500, { ok: false, error: "Failed to save setting" });
				}
				return;
			}

			if (method === "POST" && url.pathname === "/heartbeat") {
				const body = await safeParseBody(req, res);
				if (!body) return;
				if (!validateTokenBody(body, sessionToken, res)) return;
				touchHeartbeat();
				sendJson(res, 200, { ok: true });
				return;
			}

			if (method === "POST" && url.pathname === "/submit") {
				const body = await safeParseBody(req, res);
				if (!body) return;
				if (!validateTokenBody(body, sessionToken, res)) return;
				if (completed) {
					sendJson(res, 409, { ok: false, error: "Session closed" });
					return;
				}

				const payload = body as { selections?: unknown; notes?: unknown; finalNotes?: unknown };
				const selections = toSelectionsMap(payload.selections);
				if (!selections) {
					sendJson(res, 400, { ok: false, error: "Invalid selections payload" });
					return;
				}
				const notes = toStringMap(payload.notes) ?? undefined;
				const finalNotes = typeof payload.finalNotes === "string" ? payload.finalNotes.trim() : undefined;

				touchHeartbeat();
				if (autoSaveOnSubmit !== false) {
					try {
						saveDeckSnapshot(config, selections, assetsDir, normalizedCwd, gitBranch, sessionId, snapshotDir || DECK_SNAPSHOTS_DIR, {
							status: "submitted",
							notes,
							finalNotes: finalNotes || undefined,
						});
					} catch {}
				}
				markCompleted();
				unregisterSession(sessionId);
				pushEvent("deck-close", { reason: "submitted" });
				sendJson(res, 200, { ok: true });
				setImmediate(() => callbacks.onSubmit(selections, notes, finalNotes || undefined));
				return;
			}

			if (method === "POST" && url.pathname === "/save") {
				const body = await safeParseBody(req, res);
				if (!body) return;
				if (!validateTokenBody(body, sessionToken, res)) return;
				if (completed) {
					sendJson(res, 409, { ok: false, error: "Session closed" });
					return;
				}

				const payload = body as { selections?: unknown; notes?: unknown; finalNotes?: unknown };
				const selections = toSelectionsMap(payload.selections) ?? {};
				const notes = toStringMap(payload.notes) ?? undefined;
				const finalNotes = typeof payload.finalNotes === "string" ? payload.finalNotes.trim() : undefined;

				try {
					const result = saveDeckSnapshot(config, selections, assetsDir, normalizedCwd, gitBranch, sessionId, snapshotDir || DECK_SNAPSHOTS_DIR, {
						status: "in-progress",
						notes,
						finalNotes: finalNotes || undefined,
					});
					sendJson(res, 200, { ok: true, path: result.path, relativePath: result.relativePath });
				} catch (err) {
					const message = err instanceof Error ? err.message : "Save failed";
					sendJson(res, 500, { ok: false, error: message });
				}
				return;
			}

			if (method === "POST" && url.pathname === "/cancel") {
				const body = await safeParseBody(req, res);
				if (!body) return;
				if (!validateTokenBody(body, sessionToken, res)) return;
				if (completed) {
					sendJson(res, 200, { ok: true });
					return;
				}

				const payload = body as { reason?: string; selections?: unknown };
				const reason =
					payload.reason === "stale" || payload.reason === "aborted" || payload.reason === "user"
						? payload.reason
						: "user";

				const cancelSelections = toSelectionsMap(payload.selections);
				if (cancelSelections && Object.keys(cancelSelections).length > 0) {
					try {
						saveDeckSnapshot(config, cancelSelections, assetsDir, normalizedCwd, gitBranch, sessionId, snapshotDir || DECK_SNAPSHOTS_DIR, {
							status: "cancelled",
						});
					} catch {}
				}

				markCompleted();
				unregisterSession(sessionId);
				pushEvent("deck-close", { reason });
				sendJson(res, 200, { ok: true });
				setImmediate(() => callbacks.onCancel(reason));
				return;
			}

			if (method === "POST" && url.pathname === "/generate-more") {
				const body = await safeParseBody(req, res);
				if (!body) return;
				if (!validateTokenBody(body, sessionToken, res)) return;
				if (completed) {
					sendJson(res, 409, { ok: false, error: "Session closed" });
					return;
				}

				const payload = body as { slideId?: string; prompt?: string; model?: string; thinking?: string; count?: number };
				if (typeof payload.slideId !== "string" || payload.slideId.trim() === "") {
					sendJson(res, 400, { ok: false, error: "slideId is required" });
					return;
				}
				if (!knownSlideIds.has(payload.slideId)) {
					sendJson(res, 404, { ok: false, error: "Unknown slide" });
					return;
				}
				if (pendingGenerate) {
					sendJson(res, 409, { ok: false, error: "A generation is already in progress" });
					return;
				}

				const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() || undefined : undefined;
				const model = typeof payload.model === "string" ? (payload.model.trim() || "") : undefined;
				const thinking = typeof payload.thinking === "string" ? payload.thinking.trim() || undefined : undefined;
				const count = typeof payload.count === "number" && payload.count >= 1 && payload.count <= 5 ? payload.count : 1;

				setPendingGenerate(payload.slideId as string, false);
				touchHeartbeat();
				sendJson(res, 200, { ok: true });
				setImmediate(() => {
					callbacks.onGenerateMore(payload.slideId as string, prompt, model, thinking, count);
				});
				return;
			}

			if (method === "POST" && url.pathname === "/regenerate-slide") {
				const body = await safeParseBody(req, res);
				if (!body) return;
				if (!validateTokenBody(body, sessionToken, res)) return;
				if (completed) {
					sendJson(res, 409, { ok: false, error: "Session closed" });
					return;
				}

				const payload = body as { slideId?: string; prompt?: string; model?: string; thinking?: string };
				if (typeof payload.slideId !== "string" || payload.slideId.trim() === "") {
					sendJson(res, 400, { ok: false, error: "slideId is required" });
					return;
				}
				if (!knownSlideIds.has(payload.slideId)) {
					sendJson(res, 404, { ok: false, error: "Unknown slide" });
					return;
				}
				if (pendingGenerate) {
					sendJson(res, 409, { ok: false, error: "A generation is already in progress" });
					return;
				}

				const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() || undefined : undefined;
				const model = typeof payload.model === "string" ? (payload.model.trim() || "") : undefined;
				const thinking = typeof payload.thinking === "string" ? payload.thinking.trim() || undefined : undefined;

				setPendingGenerate(payload.slideId as string, true);
				touchHeartbeat();
				sendJson(res, 200, { ok: true });
				setImmediate(() => {
					callbacks.onRegenerateSlide(payload.slideId as string, prompt, model, thinking);
				});
				return;
			}

			sendText(res, 404, "Not found");
		} catch (err) {
			const message = err instanceof Error ? err.message : "Server error";
			sendJson(res, 500, { ok: false, error: message });
		}
	});

	return new Promise((resolve, reject) => {
		const onError = (err: Error) => {
			reject(new Error(`Failed to start deck server: ${err.message}`));
		};

		server.once("error", onError);
		server.listen(port ?? 0, "127.0.0.1", () => {
			server.off("error", onError);
			const addr = server.address();
			if (!addr || typeof addr === "string") {
				reject(new Error("Failed to start deck server: invalid address"));
				return;
			}

			const url = `http://localhost:${addr.port}/?session=${sessionToken}`;
			const now = Date.now();
			sessionEntry = {
				id: sessionId,
				url,
				cwd: normalizedCwd,
				gitBranch,
				title: config.title || "Design Deck",
				startedAt: now,
				lastSeen: now,
			};
			registerSession(sessionEntry);

			if (!watchdog) {
				watchdog = setInterval(() => {
					if (completed || !browserConnected) return;
					if (Date.now() - lastHeartbeatAt <= ABANDONED_GRACE_MS) return;
					if (!markCompleted()) return;
					unregisterSession(sessionId);
					pushEvent("deck-close", { reason: "stale" });
					setImmediate(() => callbacks.onCancel("stale"));
				}, WATCHDOG_INTERVAL_MS);
			}

			resolve({
				url,
				port: addr.port,
				close: (reason?: string) => {
					if (!completed) {
						markCompleted();
						unregisterSession(sessionId);
						pushEvent("deck-close", { reason: reason || "closed" });
					}
					try {
						server.close();
					} catch {}
					closeSSE();
					try {
						rmSync(assetsDir, { recursive: true, force: true });
					} catch {}
				},
				pushOption: (slideId: string, option: DeckOption) => {
					if (completed) {
						throw new Error("Deck session is closed");
					}
					try {
						if (!isDeckOption(option)) {
							throw new Error("Invalid deck option payload");
						}
						const slide = config.slides.find((s) => s.id === slideId);
						if (!slide) {
							throw new Error(`Unknown slide id: ${slideId}`);
						}
						const processed = processOptionAssets(option, assetsDir);
						slide.options.push(processed);
						clearPendingGenerate();
						pushEvent("new-option", { slideId, option: processed });
					} catch (err) {
						clearPendingGenerate();
						pushEvent("generate-failed", { slideId });
						throw err;
					}
				},
				cancelGenerate: () => {
					if (!pendingGenerate) return;
					const { slideId, isRegen } = pendingGenerate;
					clearPendingGenerate();
					pushEvent(isRegen ? "regenerate-failed" : "generate-failed", { slideId });
				},
				replaceSlideOptions: (slideId: string, options: DeckOption[]) => {
					if (completed) {
						throw new Error("Deck session is closed");
					}
					try {
						const slide = config.slides.find((s) => s.id === slideId);
						if (!slide) {
							throw new Error(`Unknown slide id: ${slideId}`);
						}
						const processedOptions = options.map((opt) => {
							if (!isDeckOption(opt)) {
								throw new Error("Invalid deck option payload");
							}
							return processOptionAssets(opt, assetsDir);
						});
						slide.options = processedOptions;
						clearPendingGenerate();
						pushEvent("replace-options", { slideId, options: processedOptions });
					} catch (err) {
						clearPendingGenerate();
						pushEvent("regenerate-failed", { slideId });
						throw err;
					}
				},
			});
		});
	});
}
