import type { CheckState, Mergeable, QueueStatus, QueueSummary } from "../github/model";
import { THEME } from "./theme";

export const STATUS_COLOR: Record<QueueStatus, string> = {
  ok: THEME.ok,
  pending: THEME.warn,
  failure: THEME.error,
  empty: THEME.idle,
};

export const CHECK_COLOR: Record<CheckState, string> = {
  success: THEME.ok,
  pending: THEME.warn,
  failure: THEME.error,
  none: THEME.idle,
};

/** Color of one pull request: conflicts win over the check state. */
export function prColor(checks: CheckState, mergeable: Mergeable): string {
  return mergeable === "CONFLICTING" ? THEME.error : CHECK_COLOR[checks];
}

const CHECK_LABEL: Record<CheckState, string> = {
  success: "checks passed",
  pending: "checks running",
  failure: "checks failed",
  none: "no checks",
};

/** Short state text of one pull request. */
export function checkLabel(checks: CheckState, mergeable: Mergeable): string {
  return mergeable === "CONFLICTING" ? "merge conflict" : CHECK_LABEL[checks];
}

const CHECK_WORD: Record<CheckState, string> = {
  success: "passed",
  pending: "running",
  failure: "failed",
  none: "no checks",
};

/** One-word state for tight spaces (key footer). */
export function checkWord(checks: CheckState, mergeable: Mergeable): string {
  return mergeable === "CONFLICTING" ? "conflict" : CHECK_WORD[checks];
}

/** Caption under the count on the Queue key. */
export function queueCaption(summary: QueueSummary): string {
  switch (summary.status) {
    case "empty":
      return "no open PRs";
    case "failure":
      return `${summary.failure} failed`;
    case "pending":
      return `${summary.pending} running`;
    default:
      return summary.conflicts > 0 ? `${summary.conflicts} conflict${summary.conflicts === 1 ? "" : "s"}` : "all green";
  }
}

/**
 * Shortens a Renovate PR title for a key: drops the conventional-commit
 * prefix and turns "Update dependency x to v2" into "x → v2".
 */
/**
 * What a Renovate pull request updates, split for the key: the dependency
 * ("postgres", "@elgato/streamdeck") and the target version ("v18"). Noise
 * like "Docker tag", "action" or "dependency" is dropped so the name stays
 * big and readable. Titles that are not updates come back as `subject` only.
 */
export function prSubject(title: string): { subject: string; version?: string } {
  const compact = compactTitle(title);
  const arrow = compact.indexOf(" → ");
  if (arrow < 0) {
    return { subject: compact };
  }
  const subject = compact
    .slice(0, arrow)
    .replace(/\s+(docker\s+tag|docker\s+image|helm\s+release|github\s+action|action|dependency|monorepo|packages)$/i, "")
    .trim();
  return { subject: subject || compact.slice(0, arrow), version: compact.slice(arrow + 3) };
}

export function compactTitle(title: string): string {
  let text = title.trim().replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, "");
  const update = text.match(/^(?:update|upgrade)\s+(?:dependency\s+)?(.+?)\s+to\s+(\S+?)\s*(\(.*\))?$/i);
  if (update) {
    text = `${update[1]} → ${update[2]}`;
  } else {
    text = text.replace(/^(update|upgrade)\s+dependency\s+/i, "$1 ");
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}
