import http from "node:http";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeckConfig, DeckNotes } from "./deck-schema.ts";
import type { DeckServerCallbacks, DeckServerHandle, DeckServerOptions } from "./deck-server.ts";

type RequestResult = {
	status: number;
	headers: http.IncomingHttpHeaders;
	body: string;
};

type StartOverrides = Partial<Omit<DeckServerOptions, "config" | "sessionToken" | "sessionId" | "cwd">> & {
	config?: DeckConfig;
	sessionToken?: string;
	sessionId?: string;
	cwd?: string;
	onSubmit?: DeckServerCallbacks["onSubmit"];
};

let testHome: string;
let handle: DeckServerHandle | null = null;

function makeDeck(title = "Moshi & Deck"): DeckConfig {
	return {
		title,
		slides: [
			{
				id: "choice",
				title: "Pick one",
				options: [{ label: "A", previewHtml: "<div>A</div>" }],
			},
		],
	};
}

async function startServer(overrides: StartOverrides = {}): Promise<DeckServerHandle> {
	const { startDeckServer } = await import("./deck-server.ts");
	const {
		config = makeDeck(),
		sessionToken = "test-token",
		sessionId = "test-session",
		cwd = process.cwd(),
		snapshotDir = join(testHome, "snapshots"),
		onSubmit = () => {},
		...options
	} = overrides;
	return startDeckServer(
		{
			...options,
			config,
			sessionToken,
			sessionId,
			cwd,
			snapshotDir,
		},
		{
			onSubmit,
			onCancel: () => {},
			onGenerateMore: () => {},
			onRegenerateSlide: () => {},
		}
	);
}

function request(port: number, path = "/", options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<RequestResult> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				hostname: "127.0.0.1",
				port,
				path,
				method: options.method ?? "GET",
				agent: false,
				headers: { Connection: "close", ...options.headers },
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => {
					resolve({
						status: res.statusCode ?? 0,
						headers: res.headers,
						body: Buffer.concat(chunks).toString("utf8"),
					});
				});
			}
		);
		req.on("error", reject);
		req.end(options.body);
	});
}

function postJson(port: number, path: string, payload: unknown): Promise<RequestResult> {
	return request(port, path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
}

beforeEach(() => {
	testHome = mkdtempSync(join(tmpdir(), "deck-server-test-"));
	vi.resetModules();
	vi.stubEnv("HOME", testHome);
});

afterEach(() => {
	if (handle) {
		handle.close("test-cleanup");
		handle = null;
	}
	vi.unstubAllEnvs();
	rmSync(testHome, { recursive: true, force: true });
});

describe("startDeckServer Moshi discovery", () => {
	it("starts on a Moshi-discoverable low port by default", async () => {
		handle = await startServer();

		expect(handle.port).toBeGreaterThanOrEqual(8377);
		expect(handle.port).toBeLessThanOrEqual(8396);
		expect(handle.url).toContain(`http://localhost:${handle.port}`);
		expect(handle.url).toContain("session=test-token");
	});

	it("scans forward when the first low port is already in use", async () => {
		const first = await startServer({ sessionToken: "first-token", sessionId: "first-session" });
		try {
			handle = await startServer({ sessionToken: "second-token", sessionId: "second-session" });

			expect(handle.port).not.toBe(first.port);
			expect(handle.port).toBeGreaterThanOrEqual(8377);
			expect(handle.port).toBeLessThanOrEqual(8396);
		} finally {
			first.close("test-cleanup");
		}
	});

	it("serves a stateless tokenless landing shell without the Sec-Fetch-Mode gate", async () => {
		handle = await startServer();

		const res = await request(handle.port, "/", { headers: { "Sec-Fetch-Mode": "cors" } });

		expect(res.status).toBe(200);
		expect(res.headers["content-type"]).toContain("text/html");
		expect(res.body).toContain("<title>Moshi &amp; Deck</title>");
		expect(res.body).toContain('location.replace("/?session=test-token")');
	});

	it("answers HEAD discovery probes without a session token", async () => {
		handle = await startServer();

		const res = await request(handle.port, "/", { method: "HEAD" });

		expect(res.status).toBe(200);
		expect(res.headers["content-type"]).toContain("text/html");
		expect(res.body).toBe("");
	});

	it("rejects non-loopback Host headers before serving the tokenless shell", async () => {
		handle = await startServer();

		const res = await request(handle.port, "/", { headers: { Host: "attacker.example" } });

		expect(res.status).toBe(403);
		expect(res.body).toBe("Invalid host");
	});

	it("accepts bracketed IPv6 loopback Host headers", async () => {
		handle = await startServer();

		const res = await request(handle.port, "/", { headers: { Host: `[::1]:${handle.port}` } });

		expect(res.status).toBe(200);
		expect(res.body).toContain('location.replace("/?session=test-token")');
	});

	it("keeps the sessions file owner-only when replacing a stale tmp file", async () => {
		const piDir = join(testHome, ".pi");
		mkdirSync(piDir, { recursive: true });
		const tmpSessionsFile = join(piDir, "deck-sessions.json.tmp");
		writeFileSync(tmpSessionsFile, "{}", { mode: 0o644 });
		chmodSync(tmpSessionsFile, 0o644);

		handle = await startServer();

		const mode = statSync(join(piDir, "deck-sessions.json")).mode & 0o777;
		expect(mode).toBe(0o600);
	});
});

describe("feedback on submit and save", () => {
	function makeFeedbackDeck(): DeckConfig {
		const image = join(testHome, "hero.png");
		writeFileSync(image, "png");
		return {
			title: "Feedback",
			slides: [
				{
					id: "hero",
					title: "Hero",
					options: [
						{ label: "Banner", previewBlocks: [{ type: "image", src: image, alt: "Banner" }] },
						{ label: "Plain", previewHtml: "<div>Plain</div>" },
					],
				},
			],
		};
	}

	// Feedback on the unselected option must survive too.
	const notes: DeckNotes = {
		hero: {
			Banner: { note: "Bigger logo", pins: [{ id: "p1", target: "image", blockIndex: 0, x: 0.62, y: 0.18, text: "logo too small" }] },
			Plain: { note: "", pins: [{ id: "p2", target: "option", blockIndex: -1, x: 0.4, y: 0.1, text: "colors off" }] },
		},
	};

	function readSnapshot(dir: string): { notes?: DeckNotes; status?: string } {
		return JSON.parse(readFileSync(join(dir, "deck.json"), "utf8"));
	}

	it("/submit hands every option's notes and pins to the agent and the snapshot", async () => {
		let onSubmit: DeckServerCallbacks["onSubmit"] = () => {};
		const submitted = new Promise((resolve) => {
			onSubmit = (selections, submittedNotes) => resolve({ selections, notes: submittedNotes });
		});
		handle = await startServer({ config: makeFeedbackDeck(), onSubmit });

		const res = await postJson(handle.port, "/submit", { token: "test-token", selections: { hero: "Banner" }, notes });

		expect(res.status).toBe(200);
		expect(await submitted).toEqual({ selections: { hero: "Banner" }, notes });
		const snapshots = join(testHome, "snapshots");
		const [folder] = readdirSync(snapshots);
		expect(readSnapshot(join(snapshots, folder!))).toMatchObject({ status: "submitted", notes });
	});

	it("/save writes notes and pins to deck.json", async () => {
		handle = await startServer({ config: makeFeedbackDeck() });

		const res = await postJson(handle.port, "/save", { token: "test-token", selections: {}, notes });

		expect(res.status).toBe(200);
		expect(readSnapshot(JSON.parse(res.body).path).notes).toEqual(notes);
	});

	it("rejects malformed notes instead of dropping them", async () => {
		handle = await startServer({ config: makeFeedbackDeck() });

		const res = await postJson(handle.port, "/submit", { token: "test-token", selections: { hero: "Banner" }, notes: { hero: "Bigger logo" } });

		expect(res.status).toBe(400);
		expect(JSON.parse(res.body).error).toContain("must map option labels");
	});
});
