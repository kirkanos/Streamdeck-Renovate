/** Data model of the open Renovate pull requests reported by GitHub. */

/** Combined state of the checks of a pull request (statusCheckRollup). */
export type CheckState = "success" | "pending" | "failure" | "none";

/** GitHub's `mergeable` field of a pull request. */
export type Mergeable = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";

export type PullRequest = {
  /** GraphQL node id. */
  id: string;
  /** Repository as "owner/name". */
  repo: string;
  number: number;
  title: string;
  url: string;
  checks: CheckState;
  mergeable: Mergeable;
  isDraft: boolean;
  labels: string[];
  /** True for major version updates (see {@link isMajorUpdate}). */
  major: boolean;
};

/** Status of the whole queue, derived from the checks of all pull requests. */
export type QueueStatus = "ok" | "pending" | "failure" | "empty";

export type QueueSummary = {
  total: number;
  success: number;
  pending: number;
  failure: number;
  none: number;
  conflicts: number;
  status: QueueStatus;
};

/** Maps a GraphQL `StatusState` (statusCheckRollup.state) to a {@link CheckState}. */
export function checkStateFromRollup(state: string | null | undefined): CheckState {
  switch (state) {
    case "SUCCESS":
      return "success";
    case "PENDING":
    case "EXPECTED":
      return "pending";
    case "FAILURE":
    case "ERROR":
      return "failure";
    default:
      return "none";
  }
}

export function mergeableFromGraphQL(value: string | null | undefined): Mergeable {
  return value === "MERGEABLE" || value === "CONFLICTING" ? value : "UNKNOWN";
}

/**
 * Renovate marks major updates in the PR body ("| major |" in the update
 * table); some setups add a "major" label or mention it in the title.
 */
export function isMajorUpdate(pr: { title: string; labels: string[]; body?: string }): boolean {
  if (pr.labels.some((label) => /\bmajor\b/i.test(label))) {
    return true;
  }
  if (/\bmajor\b/i.test(pr.title)) {
    return true;
  }
  return pr.body ? /\|\s*major\s*\|/i.test(pr.body) : false;
}

/**
 * Green when every PR's checks pass (or a PR has no checks), yellow while
 * checks run and red as soon as one check failed.
 */
export function summarize(prs: PullRequest[]): QueueSummary {
  const summary: QueueSummary = { total: prs.length, success: 0, pending: 0, failure: 0, none: 0, conflicts: 0, status: "empty" };
  for (const pr of prs) {
    summary[pr.checks]++;
    if (pr.mergeable === "CONFLICTING") {
      summary.conflicts++;
    }
  }
  if (summary.total === 0) {
    summary.status = "empty";
  } else if (summary.failure > 0) {
    summary.status = "failure";
  } else if (summary.pending > 0) {
    summary.status = "pending";
  } else {
    summary.status = "ok";
  }
  return summary;
}

export type QueueFilter = {
  /** Repositories ("owner/name") to show; empty or missing = all. */
  repos?: string[];
  hideMajors?: boolean;
};

export function filterPullRequests(prs: PullRequest[], filter: QueueFilter = {}): PullRequest[] {
  const repos = new Set((filter.repos ?? []).map((r) => r.trim().toLowerCase()).filter(Boolean));
  return prs.filter((pr) => {
    if (repos.size > 0 && !repos.has(pr.repo.toLowerCase())) {
      return false;
    }
    if (filter.hideMajors && pr.major) {
      return false;
    }
    return true;
  });
}

/** Stable browsing order: by repository, then by PR number. */
export const byRepoAndNumber = (a: PullRequest, b: PullRequest): number => a.repo.localeCompare(b.repo) || a.number - b.number;

/** "owner/name" → "name". */
export function shortRepo(nameWithOwner: string): string {
  const slash = nameWithOwner.indexOf("/");
  return slash >= 0 ? nameWithOwner.slice(slash + 1) : nameWithOwner;
}
