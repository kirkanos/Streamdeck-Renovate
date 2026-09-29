import type { PullRequest } from "./github/model";

/** Holding a key this long merges the pull request shown in browse mode. */
export const LONG_PRESS_MS = 600;

/** Browse mode returns to the summary after this much time without input. */
export const IDLE_MS = 15_000;

/** Moves `index` by `delta` positions, wrapping around at both ends. */
export function wrapIndex(index: number, delta: number, total: number): number {
  if (total <= 0) {
    return -1;
  }
  const from = index < 0 ? 0 : index;
  return (((from + delta) % total) + total) % total;
}

/**
 * Index to show after the list changed: the previously selected pull request
 * if it is still there, otherwise the old position clamped into the list
 * (so the next pull request takes the place of a merged one). -1 when empty.
 */
export function resolveIndex(prs: PullRequest[], selectedId: string | undefined, index: number): number {
  if (prs.length === 0) {
    return -1;
  }
  const found = selectedId === undefined ? -1 : prs.findIndex((pr) => pr.id === selectedId);
  if (found >= 0) {
    return found;
  }
  return Math.min(Math.max(index, 0), prs.length - 1);
}
