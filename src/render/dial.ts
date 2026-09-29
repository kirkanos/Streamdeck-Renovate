import type { CheckState, Mergeable, PullRequest, QueueSummary } from "../github/model";
import { shortRepo } from "../github/model";
import { checkLabel, compactTitle, prColor, queueCaption, STATUS_COLOR } from "./format";
import { prStrip } from "./keys";
import { background, mix, svg, text, toDataUrl, truncate, wrapText } from "./svg";
import { THEME } from "./theme";

/** Touch strip segment of one dial (Stream Deck + / + XL). */
const W = 200;
const H = 100;

export type DialCanvas = {
  repo: string;
  title: string;
  checks: CheckState;
  mergeable: Mergeable;
  major?: boolean;
  /** Position in the queue, counted from 1. */
  position: number;
  total: number;
};

/** One pull request on the touch strip. */
export function dialCanvas(d: DialCanvas): string {
  const conflict = d.mergeable === "CONFLICTING";
  const color = prColor(d.checks, d.mergeable);
  const strong = conflict || d.checks === "failure";
  const bg = strong
    ? background("bg", mix(color, "#000000", 0.05), mix(color, THEME.base, 0.55), W, H)
    : background("bg", mix(color, THEME.base, 0.8), THEME.base, W, H);

  const dot = `<circle cx="16" cy="19" r="5" fill="${strong ? "#FFFFFF" : color}"/>`;
  const repo = text(truncate(shortRepo(d.repo), 15), { x: 28, y: 25, size: 17, anchor: "start" });
  const position = text(`${d.position} / ${d.total}`, { x: W - 12, y: 25, size: 14, weight: 700, opacity: 0.8, anchor: "end" });

  const lines = wrapText(compactTitle(d.title), 24, 2);
  const title = lines.map((line, i) => text(line, { x: 12, y: 50 + i * 18, size: 15, weight: 600, opacity: 0.95, anchor: "start" })).join("");

  const state = checkLabel(d.checks, d.mergeable) + (d.major && !conflict ? " · major" : "");
  const caption = text(state, { x: 12, y: 90, size: 12, weight: 600, opacity: 0.75, anchor: "start" });

  return toDataUrl(svg(W, H, bg + dot + repo + position + title + caption));
}

/** Summary on the touch strip when nothing is selected yet. */
export function dialSummary(summary: QueueSummary, prs: Pick<PullRequest, "checks" | "mergeable">[] = []): string {
  const color = STATUS_COLOR[summary.status];
  const bg =
    summary.status === "empty"
      ? background("bg", THEME.surface, THEME.base, W, H)
      : background("bg", mix(color, THEME.base, 0.8), THEME.base, W, H);
  const dot = `<circle cx="16" cy="19" r="5" fill="${color}"/>`;
  const label = text("Renovate", { x: 28, y: 25, size: 17, anchor: "start" });
  const count = text(String(summary.total), { x: 12, y: 66, size: 30, weight: 800, anchor: "start", suffix: summary.total === 1 ? "PR" : "PRs", suffixSize: 15 });
  const caption = text(queueCaption(summary), { x: 12, y: 88, size: 13, weight: 600, opacity: 0.7, anchor: "start" });
  const strip = prStrip(prs, 122, 50, 66, 18, 8);
  return toDataUrl(svg(W, H, bg + dot + label + count + caption + strip));
}

export function dialMessage(title: string, subtitle: string): string {
  return toDataUrl(
    svg(
      W,
      H,
      background("bg", THEME.surface, THEME.base, W, H) +
        text(title, { x: 12, y: 44, size: 20, weight: 800, anchor: "start" }) +
        text(subtitle, { x: 12, y: 70, size: 14, weight: 600, fill: THEME.subtle, anchor: "start" }),
    ),
  );
}
