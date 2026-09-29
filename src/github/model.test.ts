import { describe, expect, it } from "vitest";
import {
  byRepoAndNumber,
  checkStateFromRollup,
  filterPullRequests,
  isMajorUpdate,
  mergeableFromGraphQL,
  type PullRequest,
  shortRepo,
  summarize,
} from "./model";

const pr = (over: Partial<PullRequest> = {}): PullRequest => ({
  id: "PR_1",
  repo: "kirkanos/kuma-glance",
  number: 12,
  title: "chore(deps): update dependency vitest to v5",
  url: "https://github.com/kirkanos/kuma-glance/pull/12",
  checks: "success",
  mergeable: "MERGEABLE",
  isDraft: false,
  labels: [],
  major: false,
  ...over,
});

describe("GraphQL mapping", () => {
  it("maps statusCheckRollup states", () => {
    expect(checkStateFromRollup("SUCCESS")).toBe("success");
    expect(checkStateFromRollup("PENDING")).toBe("pending");
    expect(checkStateFromRollup("EXPECTED")).toBe("pending");
    expect(checkStateFromRollup("FAILURE")).toBe("failure");
    expect(checkStateFromRollup("ERROR")).toBe("failure");
    expect(checkStateFromRollup(null)).toBe("none");
    expect(checkStateFromRollup(undefined)).toBe("none");
  });

  it("maps mergeable", () => {
    expect(mergeableFromGraphQL("MERGEABLE")).toBe("MERGEABLE");
    expect(mergeableFromGraphQL("CONFLICTING")).toBe("CONFLICTING");
    expect(mergeableFromGraphQL("UNKNOWN")).toBe("UNKNOWN");
    expect(mergeableFromGraphQL(null)).toBe("UNKNOWN");
  });
});

describe("summarize", () => {
  it("is empty without pull requests", () => {
    expect(summarize([])).toMatchObject({ total: 0, status: "empty" });
  });

  it("is green when every check passed or there are no checks", () => {
    expect(summarize([pr(), pr({ id: "2", checks: "none" })])).toMatchObject({ total: 2, success: 1, none: 1, status: "ok" });
  });

  it("is yellow while checks run and red when one failed", () => {
    expect(summarize([pr(), pr({ id: "2", checks: "pending" })]).status).toBe("pending");
    expect(summarize([pr({ checks: "pending" }), pr({ id: "2", checks: "failure" })]).status).toBe("failure");
  });

  it("counts conflicts separately from the check state", () => {
    const summary = summarize([pr({ mergeable: "CONFLICTING" }), pr({ id: "2" })]);
    expect(summary).toMatchObject({ conflicts: 1, status: "ok" });
  });
});

describe("isMajorUpdate", () => {
  it("detects the label, the title and the update table in the body", () => {
    expect(isMajorUpdate({ title: "Update node to v24", labels: ["major"] })).toBe(true);
    expect(isMajorUpdate({ title: "Update node to v24", labels: ["renovate/major"] })).toBe(true);
    expect(isMajorUpdate({ title: "Update node to v24 (major)", labels: [] })).toBe(true);
    expect(isMajorUpdate({ title: "Update node to v24", labels: [], body: "| node | `22` -> `24` | major |" })).toBe(true);
  });

  it("ignores minor updates", () => {
    expect(isMajorUpdate({ title: "Update dependency vitest to v5.0.2", labels: ["dependencies"], body: "| vitest | patch |" })).toBe(false);
    expect(isMajorUpdate({ title: "Update majordomo to v2", labels: [] })).toBe(false);
  });
});

describe("filterPullRequests", () => {
  const prs = [
    pr({ id: "1", repo: "kirkanos/a" }),
    pr({ id: "2", repo: "kirkanos/b", major: true }),
    pr({ id: "3", repo: "kirkanos/c" }),
  ];

  it("returns everything without a filter", () => {
    expect(filterPullRequests(prs)).toHaveLength(3);
    expect(filterPullRequests(prs, { repos: [], hideMajors: false })).toHaveLength(3);
  });

  it("filters by repository, ignoring case", () => {
    expect(filterPullRequests(prs, { repos: ["Kirkanos/A", "kirkanos/c"] }).map((p) => p.id)).toEqual(["1", "3"]);
  });

  it("hides major updates", () => {
    expect(filterPullRequests(prs, { hideMajors: true }).map((p) => p.id)).toEqual(["1", "3"]);
  });
});

describe("ordering and names", () => {
  it("sorts by repository and number", () => {
    const sorted = [pr({ id: "1", repo: "kirkanos/b", number: 3 }), pr({ id: "2", repo: "kirkanos/a", number: 9 }), pr({ id: "3", repo: "kirkanos/a", number: 2 })].sort(
      byRepoAndNumber,
    );
    expect(sorted.map((p) => p.id)).toEqual(["3", "2", "1"]);
  });

  it("shortens repository names", () => {
    expect(shortRepo("kirkanos/kuma-glance")).toBe("kuma-glance");
    expect(shortRepo("kuma-glance")).toBe("kuma-glance");
  });
});
