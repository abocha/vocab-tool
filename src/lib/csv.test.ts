import { describe, expect, it } from "vitest";
import { __buildMatchingPairsForTest } from "./csv";
import type { PackIssue } from "./csv";
import type { MatchingPair } from "../types";

describe("buildMatchingPairs", () => {
  it("splits legacy rows into individual pairs and tracks diagnostics", () => {
    const issues: PackIssue[] = [];
    const collector: { push: (issue: PackIssue) => void; list: PackIssue[] } = {
      push: (issue: PackIssue) => {
        issues.push(issue);
      },
      list: issues,
    };

    const rows = [
      {
        level: "A2",
        type: "matching",
        left: "cat | dog",
        right: "chat | chien",
      },
      {
        level: "A2",
        type: "matching",
        left: "bird",
        right: "oiseau",
      },
      {
        level: "A2",
        type: "matching",
        left: "bird",
        right: "oiseau",
      },
    ];

    const { pairs, diagnostics } = __buildMatchingPairsForTest(rows, collector as any);

    const leftRight = pairs.map((pair: MatchingPair) => `${pair.left}:${pair.right}`);

    expect(leftRight).toEqual(["bird:oiseau"]);
    expect(diagnostics.invalidRows).toBe(1);
    expect(diagnostics.duplicatePairsDropped).toBe(1);
    expect(diagnostics.pairsParsed).toBe(1);
  });
});
