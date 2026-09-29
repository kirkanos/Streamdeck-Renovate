import type { CheckState, Mergeable, PullRequest, QueueSummary } from "../github/model";
import { shortRepo } from "../github/model";
import { checkWord, compactTitle, prColor, queueCaption, STATUS_COLOR } from "./format";
import { background, mix, svg, text, toDataUrl, truncate, wrapText } from "./svg";
import { THEME } from "./theme";

/** Key images are drawn at 144×144 and scaled by Stream Deck. */
const S = 144;

function coloredBackground(color: string, strong: boolean): string {
  if (strong) {
    return background("bg", mix(color, "#000000", 0.05), mix(color, THEME.base, 0.55), S, S);
  }
  return background("bg", mix(color, THEME.base, 0.72), THEME.base, S, S);
}

/** Row of dots, one per pull request, colored by its state (at most `count`). */
export function prStrip(prs: Pick<PullRequest, "checks" | "mergeable">[], x: number, y: number, width: number, height: number, count: number): string {
  const gap = Math.max(2, Math.round(width / count / 4));
  const barWidth = (width - gap * (count - 1)) / count;
  const shown = prs.slice(0, count);
  const padded: (Pick<PullRequest, "checks" | "mergeable"> | undefined)[] = [...shown, ...Array(count - shown.length).fill(undefined)];
  return padded
    .map((pr, i) => {
      const fill = pr ? prColor(pr.checks, pr.mergeable) : THEME.muted;
      const opacity = pr ? 1 : 0.6;
      return `<rect x="${(x + i * (barWidth + gap)).toFixed(1)}" y="${y}" width="${barWidth.toFixed(1)}" height="${height}" rx="${Math.min(2, barWidth / 2).toFixed(1)}" fill="${fill}" fill-opacity="${opacity}"/>`;
    })
    .join("");
}

/** Summary key: number of open Renovate PRs, colored by the combined check state. */
export function queueKey(summary: QueueSummary, prs: Pick<PullRequest, "checks" | "mergeable">[] = []): string {
  const color = STATUS_COLOR[summary.status];
  const bg = summary.status === "empty" ? background("bg", THEME.surface, THEME.base, S, S) : coloredBackground(color, summary.status === "failure");
  const accent = summary.status === "failure" ? "" : `<rect x="0" y="0" width="${S}" height="5" fill="${color}"/>`;

  const label = text("Renovate", { x: S / 2, y: 30, size: 17, weight: 700, opacity: 0.9 });
  const count = text(String(summary.total), { x: S / 2, y: 92, size: summary.total >= 100 ? 44 : 52, weight: 800 });
  const caption = text(queueCaption(summary), { x: S / 2, y: 112, size: 14, weight: 600, opacity: 0.75 });
  const strip = prStrip(prs, 10, 122, S - 20, 12, 12);

  return toDataUrl(svg(S, S, bg + accent + label + count + caption + strip));
}

export type PrKey = {
  repo: string;
  title: string;
  checks: CheckState;
  mergeable: Mergeable;
  major?: boolean;
  /** Position in the queue, counted from 1. */
  position: number;
  total: number;
};

/** Browse mode: one pull request with repository, title and check state. */
export function prKey(k: PrKey): string {
  const conflict = k.mergeable === "CONFLICTING";
  const color = prColor(k.checks, k.mergeable);
  const strong = conflict || k.checks === "failure";
  const bg = coloredBackground(color, strong);
  const accent = strong ? "" : `<rect x="0" y="0" width="${S}" height="5" fill="${color}"/>`;

  // A warning triangle or "major" badge sits in the top-right corner; the repo name then keeps to the left.
  const hasBadge = conflict || Boolean(k.major);
  const repo = text(truncate(shortRepo(k.repo), hasBadge ? 9 : 14), { x: hasBadge ? 52 : S / 2, y: 27, size: 16, weight: 700 });
  const lines = wrapText(compactTitle(k.title), 15, 3);
  const title = lines.map((line, i) => text(line, { x: S / 2, y: 52 + i * 18, size: 14, weight: 600, opacity: 0.92 })).join("");

  const warning = conflict
    ? `<path d="M 118 14 L 132 38 L 104 38 Z" fill="#FFFFFF" fill-opacity="0.95"/>` +
      `<path d="M 118 22 V 30" stroke="${THEME.error}" stroke-width="2.5" stroke-linecap="round"/>` +
      `<circle cx="118" cy="34" r="1.5" fill="${THEME.error}"/>`
    : "";
  const majorBadge = k.major && !conflict ? text("major", { x: S - 10, y: 27, size: 11, weight: 700, opacity: 0.8, anchor: "end" }) : "";

  const footerLeft = text(`${k.position} / ${k.total}`, { x: 12, y: 128, size: 14, weight: 700, opacity: 0.8, anchor: "start" });
  const footerRight = text(checkWord(k.checks, k.mergeable), {
    x: S - 12,
    y: 128,
    size: 13,
    weight: 700,
    fill: strong ? "#FFFFFF" : color,
    anchor: "end",
  });

  return toDataUrl(svg(S, S, bg + accent + repo + title + warning + majorBadge + footerLeft + footerRight));
}

/** Neutral key with two lines of text, e.g. "Add token / see settings" or "Offline". */
export function messageKey(title: string, subtitle: string): string {
  return toDataUrl(
    svg(
      S,
      S,
      background("bg", THEME.surface, THEME.base, S, S) +
        `<rect x="3" y="3" width="${S - 6}" height="${S - 6}" rx="14" fill="none" stroke="${THEME.muted}" stroke-width="2"/>` +
        text(title, { x: S / 2, y: 68, size: 22, weight: 800 }) +
        text(subtitle, { x: S / 2, y: 92, size: 15, weight: 600, fill: THEME.subtle }),
    ),
  );
}
