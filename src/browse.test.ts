import { describe, expect, it } from "vitest";
import { resolveIndex, wrapIndex } from "./browse";
import type { PullRequest } from "./github/model";

const pr = (id: string): PullRequest => ({
  id,
  repo: "kirkanos/x",
  number: 1,
  title: "t",
  url: "",
  checks: "success",
  mergeable: "MERGEABLE",
  isDraft: false,
  labels: [],
  major: false,
});

describe("wrapIndex", () => {
  it("wraps around at both ends", () => {
    expect(wrapIndex(0, 1, 3)).toBe(1);
    expect(wrapIndex(2, 1, 3)).toBe(0);
    expect(wrapIndex(0, -1, 3)).toBe(2);
    expect(wrapIndex(1, -5, 3)).toBe(2);
  });

  it("starts at the first entry and is -1 for an empty list", () => {
    expect(wrapIndex(-1, 1, 3)).toBe(1);
    expect(wrapIndex(-1, 0, 3)).toBe(0);
    expect(wrapIndex(0, 1, 0)).toBe(-1);
  });
});

describe("resolveIndex", () => {
  const prs = [pr("a"), pr("b"), pr("c")];

  it("keeps the selected pull request when it moved", () => {
    expect(resolveIndex(prs, "c", 0)).toBe(2);
  });

  it("clamps the position when the selected pull request is gone", () => {
    expect(resolveIndex(prs, "gone", 1)).toBe(1);
    expect(resolveIndex(prs, "gone", 7)).toBe(2);
    expect(resolveIndex(prs, undefined, -1)).toBe(0);
  });

  it("is -1 for an empty list", () => {
    expect(resolveIndex([], "a", 0)).toBe(-1);
  });
});
