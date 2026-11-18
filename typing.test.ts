import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DeckConfig } from "./deck-schema.ts";
import type { DeckServerHandle } from "./deck-server.ts";

// Real-browser guard: anything the user types into a text field must stay in that field.
// Uses the installed Chrome (GitHub's ubuntu runners ship it) so no browser download is needed.

const deck: DeckConfig = {
	title: "Typing",
	slides: [
		{
			id: "hero",
			title: "Hero",
			options: [
				{ label: "Banner", previewHtml: '<div style="padding:24px;height:160px"><h3>Banner</h3><input class="preview-field"></div>' },
				{ label: "Gradient", previewHtml: '<div style="padding:24px;height:160px"><h3>Gradient</h3></div>' },
			],
		},
		{ id: "nav", title: "Nav", options: [{ label: "Top bar", previewHtml: "<div>Top</div>" }] },
	],
};

const SHORTCUT_KEYS = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Shift+Enter"];

let home: string;
let server: DeckServerHandle;
let browser: Browser;
let page: Page;
const generated: Array<string | undefined> = [];

// Everything a stray shortcut would change.
function deckState() {
	return page.evaluate(`({
		slide: [...document.querySelectorAll(".slide")].findIndex((s) => s.classList.contains("active")),
		selections: JSON.stringify(selections),
		commentMode,
	})`);
}

async function typeShortcutsInto(selector: string) {
	const before = await deckState();
	await page.keyboard.type("1 2cC");
	for (const key of SHORTCUT_KEYS) await page.keyboard.press(key);
	expect(await deckState()).toEqual(before);
	expect(await page.evaluate((sel) => document.activeElement === document.querySelector(sel), selector)).toBe(true);
	expect(await page.inputValue(selector)).toContain("1 2cC");
}

async function dropPin() {
	await page.click(".slide.active .comment-toggle");
	const box = (await page.locator(".slide.active .option").first().locator(".preview-surface").boundingBox())!;
	await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5);
	await page.waitForSelector(".pin-popover-input");
}

beforeAll(async () => {
	home = mkdtempSync(join(tmpdir(), "deck-typing-"));
	browser = await chromium.launch({ channel: "chrome" });
}, 30_000);

afterAll(async () => {
	await browser?.close();
	rmSync(home, { recursive: true, force: true });
});

// A fresh server per test: leaving the page sends a cancel that closes the deck.
beforeEach(async () => {
	generated.length = 0;
	const { startDeckServer } = await import("./deck-server.ts");
	server = await startDeckServer(
		{ config: deck, sessionToken: "t", sessionId: "s", cwd: home, snapshotDir: join(home, "snapshots") },
		{
			onSubmit: () => {},
			onCancel: () => {},
			onGenerateMore: (_slideId, prompt) => generated.push(prompt),
			onRegenerateSlide: () => {},
		},
	);
	page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
	await page.goto(server.url);
	await page.waitForSelector(".slide.active .option-feedback-input");
});

afterEach(async () => {
	await page.close();
	server.close();
});

describe("typing never triggers deck shortcuts", () => {
	it("keeps every key inside each kind of text field", async () => {
		await page.click(".slide.active .option-feedback-input");
		await typeShortcutsInto(".slide.active .option-feedback-input");

		await page.click(".slide.active .gen-prompt");
		await typeShortcutsInto(".slide.active .gen-prompt");

		await page.click(".slide.active .preview-field");
		await typeShortcutsInto(".slide.active .preview-field");

		await dropPin();
		await typeShortcutsInto(".pin-popover-input");
		await page.keyboard.press("Escape");
		await page.keyboard.press("Escape");

		await page.evaluate("showSlide(totalSlides - 1)");
		await page.click("#final-notes-input");
		await typeShortcutsInto("#final-notes-input");
	});

	it("keeps typing in the instructions box while options generate", async () => {
		await page.click(".slide.active .gen-prompt");
		await page.keyboard.type("warmer");
		await page.keyboard.press("Enter");
		await expect.poll(() => generated.at(-1)).toBe("warmer");

		await typeShortcutsInto(".slide.active .gen-prompt");
	});

	it("keeps typing in a field after a click on its empty parts", async () => {
		await page.click(".slide.active .option-feedback-input");
		await page.click(".slide.active .option-feedback-hint");
		await typeShortcutsInto(".slide.active .option-feedback-input");

		await dropPin();
		await page.click(".pin-popover-title");
		await typeShortcutsInto(".pin-popover-input");
		await page.keyboard.press("Escape");
		await page.keyboard.press("Escape");

		await page.evaluate("showSlide(totalSlides - 1)");
		await page.click("#final-notes-input");
		const box = (await page.locator("#final-notes-input").boundingBox())!;
		await page.mouse.click(box.x + box.width / 2, box.y - 4);
		await typeShortcutsInto("#final-notes-input");
	});

	it("treats IME Enter and Escape as composition, the way WebKit reports them", async () => {
		// WebKit sends the composition-ending key with isComposing false and keyCode 229.
		const cdp = await page.context().newCDPSession(page);
		const imeKey = async (key: string) => {
			for (const type of ["rawKeyDown", "keyUp"] as const) {
				await cdp.send("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: 229 });
			}
		};

		await page.click(".slide.active .gen-prompt");
		await page.keyboard.type("あたたかく");
		await imeKey("Enter");
		expect(generated).toEqual([]);
		await typeShortcutsInto(".slide.active .gen-prompt");

		await page.click(".slide.active .option-feedback-input");
		await imeKey("Escape");
		await typeShortcutsInto(".slide.active .option-feedback-input");
	});

	it("does not pick an option when a text selection drag ends on the card", async () => {
		await page.click(".slide.active .option-feedback-input");
		await page.keyboard.type("too dark");
		const field = (await page.locator(".slide.active .option-feedback-input").first().boundingBox())!;
		const preview = (await page.locator(".slide.active .preview-surface").first().boundingBox())!;
		await page.mouse.move(field.x + field.width - 10, field.y + 12);
		await page.mouse.down();
		await page.mouse.move(preview.x + preview.width / 2, preview.y + preview.height / 2, { steps: 5 });
		await page.mouse.up();
		expect(await deckState()).toMatchObject({ selections: "{}" });
	});

	it("routes every IME check through isImeKey", () => {
		// WebKit needs both isComposing and keyCode 229; a handler checking only one leaks IME keys.
		const js = readdirSync("form/js").map((name) => readFileSync(join("form/js", name), "utf-8")).join("\n");
		const code = js.replace(/\/\/.*$/gm, "");
		expect(code.match(/isComposing|keyCode/g)).toEqual(["isComposing", "keyCode"]);
	});
});
