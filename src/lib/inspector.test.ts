import { describe, expect, it } from "vitest";
import {
  applyInspectorFilters,
  buildHtmlExport,
  compileInspectorRegex,
  MAX_REGEX_PATTERN_LENGTH,
} from "./inspector";
import type { ExerciseItem, GapFillInspectorControls, InspectorFilters } from "../types";

describe("compileInspectorRegex", () => {
  it("creates a case-insensitive regex for valid patterns", () => {
    const { regex, error } = compileInspectorRegex("cat");

    expect(error).toBeNull();
    expect(regex).not.toBeNull();
    expect(regex!.test("The CAT sat")).toBe(true);
  });

  it("returns an error for invalid patterns", () => {
    const { regex, error } = compileInspectorRegex("(cat");

    expect(regex).toBeNull();
    expect(error).toBeTruthy();
  });

  it("rejects patterns longer than the configured maximum", () => {
    const longPattern = "a".repeat(MAX_REGEX_PATTERN_LENGTH + 1);
    const { regex, error } = compileInspectorRegex(longPattern);

    expect(regex).toBeNull();
    expect(error).toContain("Pattern exceeds");
  });
});

describe("applyInspectorFilters", () => {
  const sampleItems: ExerciseItem[] = [
    {
      id: "gapfill-1",
      type: "gapfill",
      prompt: "The cat _____ on the mat",
      answer: "sat",
      gapMode: "target",
      bankQuality: "soft",
      bankMeta: { tags: ["curated"], slot: "VERB|base|cat" },
    },
    {
      id: "matching-1",
      type: "matching",
      pairs: [
        {
          left: "chien",
          right: "dog",
        },
      ],
    },
    {
      id: "mcq-1",
      type: "mcq",
      prompt: "Capital of France?",
      options: ["Paris", "London"],
      answer: "Paris",
    },
  ];

  const baseFilters: InspectorFilters = {
    contains: "",
    minLength: null,
    maxLength: null,
    regex: "",
    bankQuality: "all",
    relaxedOnly: false,
  };

  it("filters by minimum length and hides selected ids", () => {
    const filters = { ...baseFilters, minLength: 15 };
    const hidden = new Set(["mcq-1"]);
    const result = applyInspectorFilters(sampleItems, filters, hidden);

    expect(result.map((item) => item.id)).toEqual(["gapfill-1"]);
  });

  it("applies regex filtering when provided", () => {
    const filters = { ...baseFilters, regex: "chien" };
    const { regex } = compileInspectorRegex(filters.regex);
    const result = applyInspectorFilters(sampleItems, filters, new Set(), { regex });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("matching-1");
  });

  it("filters gap-fill items using gap controls", () => {
    const enriched: ExerciseItem[] = [
      ...sampleItems,
      {
        id: "gapfill-2",
        type: "gapfill",
        prompt: "She likes _____ coffee and _____ tea.",
        answer: "strong",
        answers: ["strong"],
        gapMode: "collocation",
        bankQuality: "needs_review",
        bankMeta: { tags: ["relaxed"], slot: "VERB|base|coffee", usedRelax: true },
      },
    ];
    const controls: GapFillInspectorControls = {
      mode: "collocation",
      bankSize: 6,
      hints: { initialLetter: false, pos: false, collocationCue: false, tts: false },
      difficulty: "A2",
      maxBlanksPerSentence: 1,
    };

    const filtered = applyInspectorFilters(enriched, baseFilters, new Set(), { gapFill: controls });
    expect(filtered.some((item) => item.id === "gapfill-2")).toBe(false);

    const relaxed = applyInspectorFilters(enriched, baseFilters, new Set(), {
      gapFill: { ...controls, maxBlanksPerSentence: 2 },
    });
    expect(relaxed.some((item) => item.id === "gapfill-2")).toBe(true);
  });

  it("ignores regex filtering if the pattern is invalid", () => {
    const filters = { ...baseFilters, regex: "[" };
    const { regex } = compileInspectorRegex(filters.regex);
    const result = applyInspectorFilters(sampleItems, filters, new Set(), { regex });

    expect(result).toHaveLength(sampleItems.length);
  });

  it("filters gap fills by bank quality", () => {
    const filters = { ...baseFilters, bankQuality: "soft" as const };
    const result = applyInspectorFilters(sampleItems, filters, new Set());
    expect(result.map((item) => item.id)).toEqual(["gapfill-1"]);

    const stricter = { ...baseFilters, bankQuality: "needs_review" as const };
    const resultStrict = applyInspectorFilters(sampleItems, stricter, new Set());
    expect(resultStrict).toHaveLength(0);
  });

  it("filters gap fills by relaxed tag", () => {
    const enriched: ExerciseItem[] = [
      ...sampleItems,
      {
        id: "gapfill-2",
        type: "gapfill",
        prompt: "She likes _____ coffee and _____ tea.",
        answer: "strong",
        answers: ["strong"],
        gapMode: "collocation",
        bankQuality: "needs_review",
        bankMeta: { tags: ["relaxed"], slot: "VERB|base|coffee", usedRelax: true },
      },
    ];
    const filters = { ...baseFilters, relaxedOnly: true };
    const result = applyInspectorFilters(enriched, filters, new Set());
    expect(result.map((item) => item.id)).toEqual(["gapfill-2"]);
  });
});

describe("buildHtmlExport", () => {
  it("escapes dynamic content in the generated markup", () => {
    const items: ExerciseItem[] = [
      {
        id: "gapfill-xss",
        type: "gapfill",
        prompt: "<script>alert('gap')</script> _____",
        answer: "<b>answer</b>",
      },
    ];

    const exportData = buildHtmlExport(items, "gapfill", "A2");
    expect(exportData).not.toBeNull();
    const html = exportData?.html ?? "";

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<span class=\"blank\"></span>");
    expect(html).not.toContain("_____");
    expect(html).toContain("&lt;b&gt;answer&lt;/b&gt;");
  });

  it("includes both exercise prompts and an answer key", () => {
    const items: ExerciseItem[] = [
      {
        id: "mcq-1",
        type: "mcq",
        prompt: "Capital of France?",
        options: ["Paris", "London"],
        answer: "Paris",
      },
    ];

    const exportData = buildHtmlExport(items, "mcq", "B1");
    expect(exportData).not.toBeNull();
    const html = exportData?.html ?? "";

    expect(html).toContain("Exercises");
    expect(html).toContain("Answer Key");
    expect(html).toContain("Paris");
  });

  it("renders matching exercises with a word bank and blanks to fill", () => {
    const items: ExerciseItem[] = [
      {
        id: "matching-1",
        type: "matching",
        pairs: [
          { left: "chien", right: "dog" },
          { left: "chat", right: "cat" },
        ],
      },
    ];

    const exportData = buildHtmlExport(items, "matching", "A2");
    expect(exportData).not.toBeNull();
    const html = exportData?.html ?? "";

    expect(html).toContain("class=\"word-bank__list\"");
    expect(html).toContain("class=\"answer-blank\"");
    expect(html).toContain("<span class=\"option-letter\">A.</span> dog");
    expect(html).toContain("matching-table--answers");
  });

  it("includes gap-fill word banks and hints when controls are supplied", () => {
    const items: ExerciseItem[] = [
      {
        id: "gapfill-hints",
        type: "gapfill",
        prompt: "Every morning I _____ coffee.",
        answer: "drink",
        answers: ["drink"],
        bank: ["drink", "eat", "sleep", "read"],
        hints: { first: "d", pos: "VERB", cue: "coffee" },
      },
    ];

    const exportData = buildHtmlExport(items, "gapfill", "A2", {
      gapFill: {
        mode: "target",
        bankSize: 6,
        hints: {
          initialLetter: true,
          pos: true,
          collocationCue: true,
          tts: false,
        },
        difficulty: "A2",
        maxBlanksPerSentence: 1,
      },
    });

    expect(exportData).not.toBeNull();
    const html = exportData?.html ?? "";
    expect(html).toContain("gapfill-bank");
    expect(html).toContain("Starts with");
    expect(html).toContain("Collocation cue");
  });
});
