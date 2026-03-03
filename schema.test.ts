import { describe, it, expect } from "vitest";
import { validateDeckConfig, isDeckOption, validateSavedDeck, deriveDeckStatusFromFolderName } from "./deck-schema.js";

function validDeck(slideOverrides: Record<string, unknown> = {}, optionOverrides: Record<string, unknown> = {}) {
	return {
		slides: [{
			id: "s1",
			title: "Pick one",
			...slideOverrides,
			options: [
				{ label: "A", previewHtml: "<div>A</div>", ...optionOverrides },
				{ label: "B", previewHtml: "<div>B</div>" },
			],
		}],
	};
}

describe("validateDeckConfig", () => {
	describe("previewHtml (existing behavior)", () => {
		it("accepts valid deck with previewHtml", () => {
			const config = validateDeckConfig(validDeck());
			expect(config.slides).toHaveLength(1);
			expect(config.slides[0].options).toHaveLength(2);
		});

		it("rejects option with empty previewHtml and no previewBlocks", () => {
			expect(() => validateDeckConfig(validDeck({}, { previewHtml: "" }))).toThrow(
				"must have non-empty previewHtml or previewBlocks"
			);
		});

		it("rejects option with no preview at all", () => {
			expect(() => validateDeckConfig({
				slides: [{ id: "s1", title: "T", options: [{ label: "A" }] }],
			})).toThrow("must have non-empty previewHtml or previewBlocks");
		});

		it("rejects non-string previewHtml with type error, not missing-preview error", () => {
			expect(() => validateDeckConfig({
				slides: [{ id: "s1", title: "T", options: [{ label: "A", previewHtml: 42 }] }],
			})).toThrow("previewHtml must be a string");
		});
	});

	describe("previewBlocks", () => {
		it("accepts option with previewBlocks html block", () => {
			const config = validateDeckConfig({
				slides: [{
					id: "s1", title: "T",
					options: [
						{ label: "A", previewBlocks: [{ type: "html", content: "<p>Hello</p>" }] },
					],
				}],
			});
			expect(config.slides[0].options[0].previewBlocks).toHaveLength(1);
		});

		it("accepts mermaid block", () => {
			const config = validateDeckConfig({
				slides: [{
					id: "s1", title: "T",
					options: [
						{ label: "A", previewBlocks: [{ type: "mermaid", content: "graph LR\n  A-->B" }] },
					],
				}],
			});
			expect(config.slides[0].options[0].previewBlocks![0].type).toBe("mermaid");
		});

		it("accepts mermaid block with theme overrides", () => {
			const config = validateDeckConfig({
				slides: [{
					id: "s1", title: "T",
					options: [
						{ label: "A", previewBlocks: [{ type: "mermaid", content: "graph LR\n  A-->B", theme: { primaryColor: "#ff0000" } }] },
					],
				}],
			});
			const block = config.slides[0].options[0].previewBlocks![0];
			expect(block.type).toBe("mermaid");
		});

		it("accepts code block", () => {
			const config = validateDeckConfig({
				slides: [{
					id: "s1", title: "T",
					options: [
						{ label: "A", previewBlocks: [{ type: "code", code: "const x = 1;", lang: "ts" }] },
					],
				}],
			});
			const block = config.slides[0].options[0].previewBlocks![0];
			expect(block.type).toBe("code");
		});

		it("accepts image block with src, alt, and caption", () => {
			const config = validateDeckConfig({
				slides: [{
					id: "s1", title: "T",
					options: [
						{ label: "A", previewBlocks: [{ type: "image", src: "/tmp/img.png", alt: "test image", caption: "Figure 1" }] },
					],
				}],
			});
			const block = config.slides[0].options[0].previewBlocks![0];
			expect(block.type).toBe("image");
		});

		it("accepts multiple blocks in one option", () => {
			const config = validateDeckConfig({
				slides: [{
					id: "s1", title: "T",
					options: [{
						label: "A",
						previewBlocks: [
							{ type: "mermaid", content: "graph TD\n  A-->B" },
							{ type: "code", code: "app.listen(3000)", lang: "ts" },
							{ type: "html", content: "<p>Notes</p>" },
						],
					}],
				}],
			});
			expect(config.slides[0].options[0].previewBlocks).toHaveLength(3);
		});

		it("rejects both previewHtml and previewBlocks", () => {
			expect(() => validateDeckConfig({
				slides: [{
					id: "s1", title: "T",
					options: [{ label: "A", previewHtml: "<div>A</div>", previewBlocks: [{ type: "html", content: "<p>B</p>" }] }],
				}],
			})).toThrow("not both");
		});

		it("rejects empty previewBlocks array", () => {
			expect(() => validateDeckConfig({
				slides: [{
					id: "s1", title: "T",
					options: [{ label: "A", previewBlocks: [] }],
				}],
			})).toThrow("must have non-empty previewHtml or previewBlocks");
		});

		it("rejects code block with empty code", () => {
			expect(() => validateDeckConfig({
				slides: [{
					id: "s1", title: "T",
					options: [{ label: "A", previewBlocks: [{ type: "code", code: "", lang: "ts" }] }],
				}],
			})).toThrow("non-empty code");
		});

		it("rejects code block with empty lang", () => {
			expect(() => validateDeckConfig({
				slides: [{
					id: "s1", title: "T",
					options: [{ label: "A", previewBlocks: [{ type: "code", code: "x", lang: "" }] }],
				}],
			})).toThrow("non-empty lang");
		});

		it("rejects mermaid block with empty content", () => {
			expect(() => validateDeckConfig({
				slides: [{
					id: "s1", title: "T",
					options: [{ label: "A", previewBlocks: [{ type: "mermaid", content: "" }] }],
				}],
			})).toThrow("non-empty content");
		});

		it("rejects image block without alt", () => {
			expect(() => validateDeckConfig({
				slides: [{
					id: "s1", title: "T",
					options: [{ label: "A", previewBlocks: [{ type: "image", src: "/tmp/x.png", alt: "" }] }],
				}],
			})).toThrow("non-empty alt");
		});

		it("rejects image block without src", () => {
			expect(() => validateDeckConfig({
				slides: [{
					id: "s1", title: "T",
					options: [{ label: "A", previewBlocks: [{ type: "image", src: "", alt: "test" }] }],
				}],
			})).toThrow("non-empty src");
		});

		it("rejects invalid block type", () => {
			expect(() => validateDeckConfig({
				slides: [{
					id: "s1", title: "T",
					options: [{ label: "A", previewBlocks: [{ type: "video", src: "/tmp/x.mp4" }] }],
				}],
			})).toThrow("type must be one of");
		});

		it("rejects mermaid theme with non-string values", () => {
			expect(() => validateDeckConfig({
				slides: [{
					id: "s1", title: "T",
					options: [{ label: "A", previewBlocks: [{ type: "mermaid", content: "graph LR\n A-->B", theme: { primaryColor: 123 } }] }],
				}],
			})).toThrow("must be a string");
		});
	});

	describe("aside", () => {
		it("accepts option with aside string", () => {
			const config = validateDeckConfig({
				slides: [{
					id: "s1", title: "T",
					options: [{ label: "A", previewHtml: "<div>A</div>", aside: "Pros: fast\nCons: complex" }],
				}],
			});
			expect(config.slides[0].options[0].aside).toBe("Pros: fast\nCons: complex");
		});

		it("accepts option without aside", () => {
			const config = validateDeckConfig({
				slides: [{
					id: "s1", title: "T",
					options: [{ label: "A", previewHtml: "<div>A</div>" }],
				}],
			});
			expect(config.slides[0].options[0].aside).toBeUndefined();
		});

		it("rejects non-string aside", () => {
			expect(() => validateDeckConfig({
				slides: [{
					id: "s1", title: "T",
					options: [{ label: "A", previewHtml: "<div>A</div>", aside: 42 }],
				}],
			})).toThrow("aside must be a string");
		});
	});

	describe("columns", () => {
		it("accepts columns: 1", () => {
			const config = validateDeckConfig({
				slides: [{
					id: "s1", title: "T", columns: 1,
					options: [{ label: "A", previewHtml: "<div>A</div>" }],
				}],
			});
			expect(config.slides[0].columns).toBe(1);
		});

		it("accepts columns: 2", () => {
			const config = validateDeckConfig({
				slides: [{
					id: "s1", title: "T", columns: 2,
					options: [{ label: "A", previewHtml: "<div>A</div>" }],
				}],
			});
			expect(config.slides[0].columns).toBe(2);
		});

		it("accepts columns: 3", () => {
			const config = validateDeckConfig({
				slides: [{
					id: "s1", title: "T", columns: 3,
					options: [{ label: "A", previewHtml: "<div>A</div>" }],
				}],
			});
			expect(config.slides[0].columns).toBe(3);
		});

		it("rejects columns: 4", () => {
			expect(() => validateDeckConfig({
				slides: [{
					id: "s1", title: "T", columns: 4,
					options: [{ label: "A", previewHtml: "<div>A</div>" }],
				}],
			})).toThrow("columns must be 1, 2, or 3");
		});

		it("rejects columns: 0", () => {
			expect(() => validateDeckConfig({
				slides: [{
					id: "s1", title: "T", columns: 0,
					options: [{ label: "A", previewHtml: "<div>A</div>" }],
				}],
			})).toThrow("columns must be 1, 2, or 3");
		});

		it("accepts omitted columns (auto-detect)", () => {
			const config = validateDeckConfig(validDeck());
			expect(config.slides[0].columns).toBeUndefined();
		});
	});

	describe("multiSelect", () => {
		it("accepts multiSelect: true", () => {
			const config = validateDeckConfig({
				slides: [{
					id: "s1", title: "T", multiSelect: true,
					options: [{ label: "A", previewHtml: "<div>A</div>" }, { label: "B", previewHtml: "<div>B</div>" }],
				}],
			});
			expect(config.slides[0].multiSelect).toBe(true);
		});

		it("accepts multiSelect: false", () => {
			const config = validateDeckConfig({
				slides: [{
					id: "s1", title: "T", multiSelect: false,
					options: [{ label: "A", previewHtml: "<div>A</div>" }],
				}],
			});
			expect(config.slides[0].multiSelect).toBe(false);
		});

		it("accepts omitted multiSelect (defaults to undefined)", () => {
			const config = validateDeckConfig(validDeck());
			expect(config.slides[0].multiSelect).toBeUndefined();
		});

		it("rejects non-boolean multiSelect", () => {
			expect(() => validateDeckConfig({
				slides: [{
					id: "s1", title: "T", multiSelect: "yes",
					options: [{ label: "A", previewHtml: "<div>A</div>" }],
				}],
			})).toThrow("multiSelect must be a boolean");
		});
	});

	describe("reserved ids", () => {
		it('rejects slide id "summary"', () => {
			expect(() => validateDeckConfig({
				slides: [{
					id: "summary", title: "T",
					options: [{ label: "A", previewHtml: "<div>A</div>" }],
				}],
			})).toThrow('"summary" is reserved');
		});
	});
});

describe("isDeckOption with blocks", () => {
	it("accepts option with previewHtml", () => {
		expect(isDeckOption({ label: "A", previewHtml: "<div>A</div>" })).toBe(true);
	});

	it("accepts option with previewBlocks", () => {
		expect(isDeckOption({
			label: "A",
			previewBlocks: [{ type: "html", content: "<p>B</p>" }],
		})).toBe(true);
	});

	it("rejects option with both", () => {
		expect(isDeckOption({
			label: "A",
			previewHtml: "<div>A</div>",
			previewBlocks: [{ type: "html", content: "<p>B</p>" }],
		})).toBe(false);
	});

	it("rejects option with neither", () => {
		expect(isDeckOption({ label: "A" })).toBe(false);
	});

	it("rejects empty previewBlocks array", () => {
		expect(isDeckOption({ label: "A", previewBlocks: [] })).toBe(false);
	});

	it("rejects empty label", () => {
		expect(isDeckOption({ label: "", previewHtml: "<div>A</div>" })).toBe(false);
	});

	it("accepts option with aside", () => {
		expect(isDeckOption({ label: "A", previewHtml: "<div>A</div>", aside: "some notes" })).toBe(true);
	});

	it("rejects non-string aside", () => {
		expect(isDeckOption({ label: "A", previewHtml: "<div>A</div>", aside: 123 })).toBe(false);
	});

	it("rejects non-string previewHtml even with valid previewBlocks", () => {
		expect(isDeckOption({
			label: "A",
			previewHtml: 42,
			previewBlocks: [{ type: "code", code: "const x = 1;", lang: "ts" }],
		})).toBe(false);
	});

	it("rejects previewBlocks with invalid block structure", () => {
		expect(isDeckOption({
			label: "A",
			previewBlocks: [{ type: "code" }],
		})).toBe(false);
	});

	it("rejects previewBlocks with unknown block type", () => {
		expect(isDeckOption({
			label: "A",
			previewBlocks: [{ type: "video", src: "/tmp/x.mp4" }],
		})).toBe(false);
	});

	it("accepts previewBlocks with valid block structure", () => {
		expect(isDeckOption({
			label: "A",
			previewBlocks: [{ type: "code", code: "const x = 1;", lang: "ts" }],
		})).toBe(true);
	});
});

describe("validateSavedDeck", () => {
	const minConfig = {
		slides: [{ id: "s1", title: "Slide 1", options: [{ label: "A", previewHtml: "<div>A</div>" }] }],
	};

	it("validates a minimal saved deck", () => {
		const result = validateSavedDeck({ config: minConfig, selections: { s1: "A" }, savedAt: "2026-01-01" });
		expect(result.config.slides).toHaveLength(1);
		expect(result.selections).toEqual({ s1: "A" });
		expect(result.savedAt).toBe("2026-01-01");
	});

	it("handles missing selections gracefully", () => {
		const result = validateSavedDeck({ config: minConfig });
		expect(result.selections).toEqual({});
	});

	it("filters non-string selection values", () => {
		const result = validateSavedDeck({ config: minConfig, selections: { s1: "A", s2: 42 } });
		expect(result.selections).toEqual({ s1: "A" });
	});

	it("accepts array selections for multi-select slides", () => {
		const result = validateSavedDeck({ config: minConfig, selections: { s1: ["A", "B"] } });
		expect(result.selections).toEqual({ s1: ["A", "B"] });
	});

	it("accepts mixed string and array selections", () => {
		const result = validateSavedDeck({ config: minConfig, selections: { s1: "A", s2: ["B", "C"] } });
		expect(result.selections).toEqual({ s1: "A", s2: ["B", "C"] });
	});

	it("filters arrays with non-string elements", () => {
		const result = validateSavedDeck({ config: minConfig, selections: { s1: ["A", 42] } });
		expect(result.selections).toEqual({});
	});

	it("provides default savedAt when missing", () => {
		const result = validateSavedDeck({ config: minConfig });
		expect(result.savedAt).toBeTruthy();
	});

	it("preserves savedFrom metadata", () => {
		const from = { cwd: "/projects/app", branch: "main", sessionId: "abc" };
		const result = validateSavedDeck({ config: minConfig, savedFrom: from });
		expect(result.savedFrom).toEqual(from);
	});

	it("rejects non-object input", () => {
		expect(() => validateSavedDeck("string")).toThrow("must be an object");
		expect(() => validateSavedDeck(null)).toThrow("must be an object");
		expect(() => validateSavedDeck([])).toThrow("must be an object");
	});

	it("rejects invalid config", () => {
		expect(() => validateSavedDeck({ config: "bad" })).toThrow();
		expect(() => validateSavedDeck({ config: { slides: [] } })).toThrow("non-empty array");
	});
});

describe("deriveDeckStatusFromFolderName", () => {
	it("returns 'submitted' for folders ending with -submitted", () => {
		expect(deriveDeckStatusFromFolderName("tabs-myapp-main-2026-03-01-103045-submitted")).toBe("submitted");
	});

	it("returns 'cancelled' for folders ending with -cancelled", () => {
		expect(deriveDeckStatusFromFolderName("tabs-myapp-main-2026-03-01-103045-cancelled")).toBe("cancelled");
	});

	it("returns 'in-progress' for folders without status suffix", () => {
		expect(deriveDeckStatusFromFolderName("tabs-myapp-main-2026-03-01-103045")).toBe("in-progress");
	});

	it("returns 'in-progress' for random folder names", () => {
		expect(deriveDeckStatusFromFolderName("my-deck")).toBe("in-progress");
	});
});
