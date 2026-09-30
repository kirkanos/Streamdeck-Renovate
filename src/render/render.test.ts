import { describe, expect, it } from "vitest";
import { type PullRequest, summarize } from "../github/model";
import { dialCanvas, dialSummary } from "./dial";
import { checkLabel, checkWord, compactTitle, prSubject, queueCaption } from "./format";
import { messageKey, prKey, queueKey } from "./keys";
import { escapeXml, wrapText } from "./svg";
import { THEME } from "./theme";

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

const decode = (dataUrl: string) => Buffer.from(dataUrl.split(",")[1], "base64").toString("utf8");

describe("prSubject", () => {
  it("splits dependency and version and drops the noise", () => {
    expect(prSubject("Update postgres Docker tag to v18")).toEqual({ subject: "Postgres", version: "v18" });
    expect(prSubject("Update gitea/gitea Docker tag to v28")).toEqual({ subject: "Gitea/gitea", version: "v28" });
    expect(prSubject("Update actions/checkout action to v7")).toEqual({ subject: "Actions/checkout", version: "v7" });
    expect(prSubject("chore(deps): update dependency vitest to v5")).toEqual({ subject: "Vitest", version: "v5" });
    expect(prSubject("Lock file maintenance")).toEqual({ subject: "Lock file maintenance" });
  });
});

describe("compactTitle", () => {
  it("drops the conventional commit prefix and shortens updates", () => {
    expect(compactTitle("chore(deps): update dependency vitest to v5")).toBe("Vitest → v5");
    expect(compactTitle("fix(deps): update dependency @elgato/streamdeck to ^3.1.0")).toBe("@elgato/streamdeck → ^3.1.0");
    expect(compactTitle("Update actions/checkout action to v7")).toBe("Actions/checkout action → v7");
    expect(compactTitle("Update dependency node to v24 (major)")).toBe("Node → v24");
  });

  it("keeps other titles", () => {
    expect(compactTitle("chore(deps): lock file maintenance")).toBe("Lock file maintenance");
    expect(compactTitle("Pin dependencies")).toBe("Pin dependencies");
  });
});

describe("wrapText", () => {
  it("prefers spaces over dots inside versions and breaks after slashes", () => {
    expect(wrapText("@elgato/streamdeck → ^3.1.0", 24, 2)).toEqual(["@elgato/streamdeck →", "^3.1.0"]);
    expect(wrapText("Actions/checkout action → v7", 15, 3)).toEqual(["Actions/", "checkout", "action → v7"]);
    expect(wrapText("mail.example.de", 11, 2)).toEqual(["mail.", "example.de"]);
    expect(wrapText("Grafana Dashboard Production", 11, 2)).toEqual(["Grafana", "Dashboard…"]);
  });
});

describe("labels", () => {
  it("describes the check state", () => {
    expect(checkLabel("success", "MERGEABLE")).toBe("checks passed");
    expect(checkLabel("pending", "UNKNOWN")).toBe("checks running");
    expect(checkLabel("failure", "MERGEABLE")).toBe("checks failed");
    expect(checkLabel("none", "MERGEABLE")).toBe("no checks");
    expect(checkLabel("success", "CONFLICTING")).toBe("merge conflict");
    expect(checkWord("success", "CONFLICTING")).toBe("conflict");
  });

  it("captions the queue", () => {
    expect(queueCaption(summarize([]))).toBe("no open PRs");
    expect(queueCaption(summarize([pr(), pr({ id: "2" })]))).toBe("all green");
    expect(queueCaption(summarize([pr(), pr({ id: "2", checks: "pending" })]))).toBe("1 running");
    expect(queueCaption(summarize([pr({ checks: "failure" }), pr({ id: "2", checks: "pending" })]))).toBe("1 failed");
    expect(queueCaption(summarize([pr({ mergeable: "CONFLICTING" })]))).toBe("1 conflict");
  });
});

describe("key images", () => {
  it("shows the count and colors the queue key by status", () => {
    const green = decode(queueKey(summarize([pr(), pr({ id: "2" })])));
    expect(green).toContain(">2<");
    expect(green).toContain("all green");
    expect(green).toContain(`fill="${THEME.ok}"`);

    const failed = [pr({ checks: "failure" })];
    const red = decode(queueKey(summarize(failed), failed));
    expect(red).toContain("1 failed");
    expect(red).toContain(`fill="${THEME.error}"`);
    expect(red).not.toContain(THEME.ok);

    const yellow = decode(queueKey(summarize([pr({ checks: "pending" })])));
    expect(yellow).toContain(`fill="${THEME.warn}"`);
  });

  it("draws one dot per pull request", () => {
    const prs = [pr(), pr({ id: "2", checks: "failure" }), pr({ id: "3", mergeable: "CONFLICTING" })];
    const svg = decode(queueKey(summarize(prs), prs));
    expect(svg.match(/<rect[^>]*y="122"/g)).toHaveLength(12);
    expect(svg.match(new RegExp(`y="122"[^>]*fill="${THEME.error}"`, "g"))).toHaveLength(2);
  });

  it("escapes titles and shows repository, position and state", () => {
    expect(escapeXml(`<a & "b">`)).toBe("&lt;a &amp; &quot;b&quot;&gt;");
    const svg = decode(prKey({ repo: "kirkanos/r&d", title: "Update <x> to v2", checks: "pending", mergeable: "MERGEABLE", position: 2, total: 5 }));
    expect(svg).toContain("r&amp;d");
    expect(svg).not.toContain("<x>");
    expect(svg).toContain(">&lt;x&gt;<");
    expect(svg).toContain(">→ v2<");
    expect(svg).toContain("2 / 5");
    expect(svg).toContain("running");
  });

  it("warns about merge conflicts", () => {
    const svg = decode(prKey({ repo: "kirkanos/x", title: "Lock file maintenance", checks: "success", mergeable: "CONFLICTING", position: 1, total: 1 }));
    expect(svg).toContain("conflict");
    expect(svg).toContain("<path d=\"M 118 14");
    expect(svg).not.toContain(THEME.ok);
  });

  it("marks major updates", () => {
    const svg = decode(prKey({ repo: "kirkanos/x", title: "Update node to v24", checks: "none", mergeable: "MERGEABLE", major: true, position: 1, total: 1 }));
    expect(svg).toContain(">major<");
  });

  it("renders placeholder messages", () => {
    const svg = decode(messageKey("Add token", "see settings"));
    expect(svg).toContain("Add token");
    expect(svg).toContain("see settings");
  });
});

describe("dial images", () => {
  it("shows the pull request on the touch strip", () => {
    const svg = decode(dialCanvas({ repo: "kirkanos/kuma-glance", title: pr().title, checks: "success", mergeable: "MERGEABLE", position: 3, total: 4 }));
    expect(svg).toContain('width="200" height="100"');
    expect(svg).toContain("kuma-glance");
    expect(svg).toContain("Vitest → v5");
    expect(svg).toContain("3 / 4");
    expect(svg).toContain("checks passed");
  });

  it("summarizes the queue", () => {
    const svg = decode(dialSummary(summarize([pr()]), [pr()]));
    expect(svg).toContain(">1<");
    expect(svg).toContain("PR</tspan>");
    expect(svg).toContain("all green");
  });
});
