import { EventEmitter } from "node:events";
import {
  byRepoAndNumber,
  checkStateFromRollup,
  isMajorUpdate,
  mergeableFromGraphQL,
  type PullRequest,
} from "./model";

export type GitHubSettings = {
  /** Fine-grained personal access token. */
  token?: string;
  /** User or organization whose repositories are searched. */
  owner?: string;
  /** Search author of the Renovate PRs ("app/renovate" for the hosted app). */
  author?: string;
};

export const DEFAULT_OWNER = "kirkanos";
export const DEFAULT_AUTHOR = "app/renovate";
export const POLL_INTERVAL_MS = 60_000;

export type ConnectionState = "unconfigured" | "connecting" | "connected" | "error";

export type MergeMethod = "merge" | "squash" | "rebase";

export const DEFAULT_MERGE_METHOD: MergeMethod = "squash";

export type MergeResult = { ok: true } | { ok: false; error: string };

export const API_URL = "https://api.github.com";

/** Bounds the number of search pages per poll (50 PRs each). */
const MAX_PAGES = 4;

const SEARCH_QUERY = `
query RenovateQueue($q: String!, $after: String) {
  viewer { login }
  search(query: $q, type: ISSUE, first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        id
        number
        title
        url
        body
        isDraft
        mergeable
        repository { nameWithOwner }
        labels(first: 20) { nodes { name } }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
}`;

type SearchNode = {
  id?: string;
  number?: number;
  title?: string;
  url?: string;
  body?: string | null;
  isDraft?: boolean;
  mergeable?: string | null;
  repository?: { nameWithOwner: string };
  labels?: { nodes: { name: string }[] | null };
  commits?: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] | null };
};

type SearchData = {
  viewer?: { login: string };
  search: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: (SearchNode | null)[] };
};

type GraphQLResponse<T> = { data?: T; errors?: { message: string }[]; message?: string };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Error whose message is meant to be shown to the user. */
class ApiError extends Error {}

/**
 * Polls GitHub for the open Renovate pull requests and merges them.
 *
 * One GraphQL search per poll covers all repositories; browsing on keys and
 * dials only uses the cached list, so the search rate limit is never hit.
 *
 * Events:
 *   "prs"    the list of pull requests changed
 *   "state"  the connection state changed
 */
export class GitHubService extends EventEmitter<{ prs: []; state: [] }> {
  #settings: GitHubSettings = {};
  #state: ConnectionState = "unconfigured";
  #error: string | undefined;
  #login: string | undefined;
  #prs: PullRequest[] = [];
  #timer: ReturnType<typeof setInterval> | undefined;
  #inFlight: Promise<void> | undefined;
  readonly #fetch: FetchLike;

  constructor(fetchImpl: FetchLike = (input, init) => fetch(input, init)) {
    super();
    this.#fetch = fetchImpl;
  }

  get settings(): GitHubSettings {
    return this.#settings;
  }

  get state(): ConnectionState {
    return this.#state;
  }

  get error(): string | undefined {
    return this.#error;
  }

  /** Login of the token's user, known after the first successful poll. */
  get login(): string | undefined {
    return this.#login;
  }

  get isConnected(): boolean {
    return this.#state === "connected";
  }

  get owner(): string {
    return this.#settings.owner || DEFAULT_OWNER;
  }

  get author(): string {
    return this.#settings.author || DEFAULT_AUTHOR;
  }

  /** All open Renovate pull requests, sorted by repository and number. */
  pullRequests(): PullRequest[] {
    return this.#prs;
  }

  pullRequest(id: string | undefined): PullRequest | undefined {
    return id === undefined ? undefined : this.#prs.find((pr) => pr.id === id);
  }

  /** Repositories with open Renovate pull requests, sorted. */
  repos(): string[] {
    return [...new Set(this.#prs.map((pr) => pr.repo))].sort((a, b) => a.localeCompare(b));
  }

  /** Applies new settings; restarts polling only when they changed. */
  configure(settings: GitHubSettings): void {
    const next: GitHubSettings = { token: settings.token, owner: settings.owner, author: settings.author };
    if (
      next.token === this.#settings.token &&
      next.owner === this.#settings.owner &&
      next.author === this.#settings.author &&
      (this.#timer || !next.token)
    ) {
      return;
    }
    this.#settings = next;
    this.stop();
    this.#login = undefined;
    this.#setPullRequests([]);

    if (next.token) {
      this.#setState("connecting");
      this.#timer = setInterval(() => void this.refresh(), POLL_INTERVAL_MS);
      this.#timer.unref?.();
      void this.refresh();
    } else {
      this.#setState("unconfigured");
    }
  }

  /** Stops polling (the settings stay). */
  stop(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  /** Polls GitHub now; concurrent calls share one request. */
  refresh(): Promise<void> {
    if (!this.#settings.token) {
      return Promise.resolve();
    }
    this.#inFlight ??= this.#poll().finally(() => {
      this.#inFlight = undefined;
    });
    return this.#inFlight;
  }

  /**
   * Merges a pull request via the REST API. Conflicting pull requests are
   * refused here so that no key or dial can merge them by accident. After a
   * successful merge the list is updated right away and polled again.
   */
  async merge(pr: PullRequest, method: MergeMethod = DEFAULT_MERGE_METHOD): Promise<MergeResult> {
    if (!this.#settings.token) {
      return { ok: false, error: "No token configured" };
    }
    if (pr.mergeable === "CONFLICTING") {
      return { ok: false, error: `#${pr.number} has merge conflicts` };
    }
    if (pr.isDraft) {
      return { ok: false, error: `#${pr.number} is a draft` };
    }

    try {
      const response = await this.#fetch(`${API_URL}/repos/${pr.repo}/pulls/${pr.number}/merge`, {
        method: "PUT",
        headers: this.#headers(),
        body: JSON.stringify({ merge_method: method }),
      });
      const body = (await response.json().catch(() => ({}))) as { merged?: boolean; message?: string };
      if (!response.ok || body.merged === false) {
        return { ok: false, error: body.message || `Merge failed (HTTP ${response.status})` };
      }
    } catch (err) {
      return { ok: false, error: `Merge failed: ${(err as Error).message}` };
    }

    this.#setPullRequests(this.#prs.filter((p) => p.id !== pr.id));
    void this.refresh();
    return { ok: true };
  }

  async #poll(): Promise<void> {
    try {
      const prs = await this.#search();
      this.#setPullRequests(prs);
      this.#setState("connected");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : `Cannot reach GitHub: ${(err as Error).message}`;
      this.#setState("error", message);
    }
  }

  async #search(): Promise<PullRequest[]> {
    const q = `author:${this.author} is:pr is:open user:${this.owner}`;
    const prs: PullRequest[] = [];
    let after: string | null = null;

    for (let page = 0; page < MAX_PAGES; page++) {
      const data: SearchData = await this.#graphql<SearchData>(SEARCH_QUERY, { q, after });
      this.#login = data.viewer?.login ?? this.#login;
      for (const node of data.search.nodes) {
        const pr = toPullRequest(node);
        if (pr) {
          prs.push(pr);
        }
      }
      if (!data.search.pageInfo.hasNextPage || !data.search.pageInfo.endCursor) {
        break;
      }
      after = data.search.pageInfo.endCursor;
    }

    return prs.sort(byRepoAndNumber);
  }

  async #graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const response = await this.#fetch(`${API_URL}/graphql`, {
      method: "POST",
      headers: this.#headers(),
      body: JSON.stringify({ query, variables }),
    });
    const body = (await response.json().catch(() => ({}))) as GraphQLResponse<T>;

    if (response.status === 401) {
      throw new ApiError("Bad credentials, check the token");
    }
    if (response.status === 403 || response.status === 429) {
      throw new ApiError(body.message?.includes("rate limit") ? "Rate limit exceeded" : body.message || "Access denied");
    }
    if (!response.ok) {
      throw new ApiError(body.message || `GitHub error (HTTP ${response.status})`);
    }
    if (body.errors?.length) {
      throw new ApiError(body.errors.map((e) => e.message).join("; "));
    }
    if (!body.data) {
      throw new ApiError("Empty response from GitHub");
    }
    return body.data;
  }

  #headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.#settings.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "streamdeck-renovate",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  #setPullRequests(prs: PullRequest[]): void {
    const changed = JSON.stringify(prs) !== JSON.stringify(this.#prs);
    this.#prs = prs;
    if (changed) {
      this.emit("prs");
    }
  }

  #setState(state: ConnectionState, error?: string): void {
    if (state === this.#state && error === this.#error) {
      return;
    }
    this.#state = state;
    this.#error = error;
    this.emit("state");
  }
}

function toPullRequest(node: SearchNode | null): PullRequest | undefined {
  if (!node?.id || node.number === undefined || !node.repository) {
    return undefined;
  }
  const labels = (node.labels?.nodes ?? []).map((l) => l.name);
  const title = node.title ?? "";
  return {
    id: node.id,
    repo: node.repository.nameWithOwner,
    number: node.number,
    title,
    url: node.url ?? "",
    checks: checkStateFromRollup(node.commits?.nodes?.[0]?.commit.statusCheckRollup?.state),
    mergeable: mergeableFromGraphQL(node.mergeable),
    isDraft: Boolean(node.isDraft),
    labels,
    major: isMajorUpdate({ title, labels, body: node.body ?? undefined }),
  };
}

export const github = new GitHubService();
