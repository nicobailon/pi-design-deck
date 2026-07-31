import { execSync } from "node:child_process";
import { readFileSync, existsSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

export function getGitBranch(cwd: string): string | null {
	try {
		const branch = execSync("git rev-parse --abbrev-ref HEAD", {
			cwd,
			encoding: "utf8",
			timeout: 2000,
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		return branch || null;
	} catch {
		return null;
	}
}

export function normalizePath(path: string): string {
	const home = homedir();
	if (path.startsWith(home)) {
		return "~" + path.slice(home.length);
	}
	return path;
}

export interface SessionEntry {
	id: string;
	url: string;
	cwd: string;
	gitBranch: string | null;
	title: string;
	startedAt: number;
	lastSeen: number;
}

interface SessionsData {
	sessions: SessionEntry[];
}

const SESSIONS_FILE = join(homedir(), ".pi", "deck-sessions.json");
const STALE_PRUNE_MS = 60000;

function ensurePiDir(): void {
	const piDir = join(homedir(), ".pi");
	if (!existsSync(piDir)) {
		mkdirSync(piDir, { recursive: true });
	}
}

function readSessions(): SessionsData {
	try {
		if (!existsSync(SESSIONS_FILE)) {
			return { sessions: [] };
		}
		const data = readFileSync(SESSIONS_FILE, "utf8");
		const parsed = JSON.parse(data);
		if (!parsed.sessions || !Array.isArray(parsed.sessions)) {
			return { sessions: [] };
		}
		return parsed as SessionsData;
	} catch {
		return { sessions: [] };
	}
}

function writeSessions(data: SessionsData): void {
	ensurePiDir();
	const tempFile = SESSIONS_FILE + ".tmp";
	writeFileSync(tempFile, JSON.stringify(data, null, 2));
	renameSync(tempFile, SESSIONS_FILE);
}

function pruneStale(sessions: SessionEntry[]): SessionEntry[] {
	const now = Date.now();
	return sessions.filter((s) => now - s.lastSeen < STALE_PRUNE_MS);
}

export function touchSession(entry: SessionEntry): void {
	const data = readSessions();
	data.sessions = pruneStale(data.sessions);
	const existing = data.sessions.find((s) => s.id === entry.id);
	if (existing) {
		existing.lastSeen = Date.now();
		existing.url = entry.url;
		existing.cwd = entry.cwd;
		existing.gitBranch = entry.gitBranch;
		existing.title = entry.title;
		existing.startedAt = entry.startedAt;
	} else {
		data.sessions.push({ ...entry, lastSeen: Date.now() });
	}
	writeSessions(data);
}

export function registerSession(entry: SessionEntry): void {
	touchSession(entry);
}

export function unregisterSession(sessionId: string): void {
	const data = readSessions();
	data.sessions = data.sessions.filter((s) => s.id !== sessionId);
	writeSessions(data);
}

export const MAX_BODY_SIZE = 15 * 1024 * 1024;

class BodyTooLargeError extends Error {
	statusCode = 413;
}

const INLINE_JSON_ESCAPES: Record<string, string> = {
	"<": "\\u003c",
	">": "\\u003e",
	"&": "\\u0026",
};

export function safeInlineJSON(data: unknown): string {
	return JSON.stringify(data).replace(/[<>&]/g, (char) => INLINE_JSON_ESCAPES[char]);
}

export function sendText(res: ServerResponse, status: number, text: string) {
	res.writeHead(status, {
		"Content-Type": "text/plain; charset=utf-8",
		"Cache-Control": "no-store",
	});
	res.end(text);
}

export function sendJson(res: ServerResponse, status: number, payload: unknown) {
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Cache-Control": "no-store",
	});
	res.end(JSON.stringify(payload));
}

async function parseJSONBody(req: IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		let body = "";
		let size = 0;

		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_BODY_SIZE) {
				req.destroy();
				reject(new BodyTooLargeError("Request body too large"));
				return;
			}
			body += chunk.toString();
		});

		req.on("end", () => {
			try {
				resolve(JSON.parse(body));
			} catch {
				reject(new Error("Invalid JSON"));
			}
		});

		req.on("error", reject);
	});
}

export async function safeParseBody(req: IncomingMessage, res: ServerResponse): Promise<unknown | null> {
	try {
		return await parseJSONBody(req);
	} catch (err) {
		if (err instanceof BodyTooLargeError) {
			sendJson(res, err.statusCode, { ok: false, error: err.message });
		} else {
			sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : "Invalid body" });
		}
		return null;
	}
}

export function validateTokenQuery(url: URL, expectedToken: string, res: ServerResponse): boolean {
	const token = url.searchParams.get("session");
	if (token !== expectedToken) {
		sendText(res, 403, "Invalid session");
		return false;
	}
	return true;
}

export function validateTokenBody(body: unknown, expectedToken: string, res: ServerResponse): boolean {
	if (!body || typeof body !== "object") {
		sendJson(res, 400, { ok: false, error: "Invalid request body" });
		return false;
	}
	const token = (body as { token?: string }).token;
	if (token !== expectedToken) {
		sendJson(res, 403, { ok: false, error: "Invalid session" });
		return false;
	}
	return true;
}
