import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PullRequest } from "./model";
import { API_URL, type FetchLike, GitHubService, POLL_INTERVAL_MS } from "./service";

type Call = { url: string; init?: RequestInit };

const node = (over: Record<string, unknown> = {}) => ({
  id: "PR_1",
  number: 12,
  title: "chore(deps): update dependency vitest to v5",
  url: "https://github.com/kirkanos/kuma-glance/pull/12",
  body: "| vitest | minor |",
  isDraft: false,
  mergeable: "MERGEABLE",
  repository: { nameWithOwner: "kirkanos/kuma-glance" },
  labels: { nodes: [] },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
  ...over,
});

const json = (status: number, body: unknown): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

function searchResponse(nodes: unknown[], hasNextPage = false): unknown {
  return { data: { viewer: { login: "kirkanos" }, search: { pageInfo: { hasNextPage, endCursor: hasNextPage ? "c1" : null }, nodes } } };
}

describe("GitHubService", () => {
  let calls: Call[];
  let responses: Response[];
  let service: GitHubService;

  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return responses.shift() ?? json(500, { message: "no response queued" });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    responses = [];
    service = new GitHubService(fetchImpl);
  });

  afterEach(() => {
    service.stop();
    vi.useRealTimers();
  });

  it("is unconfigured without a token", () => {
    service.configure({});
    expect(service.state).toBe("unconfigured");
    expect(calls).toHaveLength(0);
  });

  it("searches with the configured owner and author and maps the result", async () => {
    responses.push(json(200, searchResponse([node(), node({ id: "PR_2", number: 3, mergeable: "CONFLICTING", commits: { nodes: [] } })])));
    const events: string[] = [];
    service.on("prs", () => events.push("prs"));
    service.on("state", () => events.push(service.state));

    service.configure({ token: "t", owner: "acme", author: "renovate-bot" });
    await service.refresh();

    expect(calls[0].url).toBe(`${API_URL}/graphql`);
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.variables.q).toBe("author:renovate-bot is:pr is:open user:acme");
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer t");

    expect(service.state).toBe("connected");
    expect(service.login).toBe("kirkanos");
    expect(service.pullRequests().map((p) => [p.number, p.checks, p.mergeable])).toEqual([
      [3, "none", "CONFLICTING"],
      [12, "success", "MERGEABLE"],
    ]);
    expect(service.repos()).toEqual(["kirkanos/kuma-glance"]);
    expect(events).toEqual(["connecting", "prs", "connected"]);
  });

  it("follows the search pages", async () => {
    responses.push(json(200, searchResponse([node()], true)), json(200, searchResponse([node({ id: "PR_2", number: 13 })])));
    service.configure({ token: "t" });
    await service.refresh();

    expect(calls).toHaveLength(2);
    expect(JSON.parse(String(calls[1].init?.body)).variables.after).toBe("c1");
    expect(service.pullRequests()).toHaveLength(2);
  });

  it("reports bad credentials", async () => {
    responses.push(json(401, { message: "Bad credentials" }));
    service.configure({ token: "bad" });
    await service.refresh();
    expect(service.state).toBe("error");
    expect(service.error).toContain("Bad credentials");
  });

  it("reports GraphQL errors", async () => {
    responses.push(json(200, { errors: [{ message: "Field 'foo' doesn't exist" }] }));
    service.configure({ token: "t" });
    await service.refresh();
    expect(service.state).toBe("error");
    expect(service.error).toBe("Field 'foo' doesn't exist");
  });

  it("polls every minute", async () => {
    responses.push(json(200, searchResponse([node()])), json(200, searchResponse([])));
    service.configure({ token: "t" });
    await service.refresh();
    expect(calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(calls).toHaveLength(2);
    expect(service.pullRequests()).toHaveLength(0);
  });

  it("merges via REST, removes the pull request and refreshes", async () => {
    responses.push(json(200, searchResponse([node()])));
    service.configure({ token: "t" });
    await service.refresh();
    const pr = service.pullRequests()[0];

    responses.push(json(200, { merged: true }), json(200, searchResponse([])));
    const result = await service.merge(pr, "rebase");

    expect(result).toEqual({ ok: true });
    expect(calls[1].url).toBe(`${API_URL}/repos/kirkanos/kuma-glance/pulls/12/merge`);
    expect(calls[1].init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ merge_method: "rebase" });
    expect(service.pullRequests()).toHaveLength(0);

    await vi.runAllTicks();
    expect(calls).toHaveLength(3);
  });

  it("refuses conflicting and draft pull requests without calling GitHub", async () => {
    service.configure({ token: "t" });
    const conflicting: PullRequest = { ...(await pull()), mergeable: "CONFLICTING" };
    expect(await service.merge(conflicting)).toEqual({ ok: false, error: "#12 has merge conflicts" });
    const draft: PullRequest = { ...(await pull()), isDraft: true };
    expect(await service.merge(draft)).toEqual({ ok: false, error: "#12 is a draft" });
    expect(calls.filter((c) => c.url.includes("/merge"))).toHaveLength(0);
  });

  it("passes GitHub's merge error on", async () => {
    responses.push(json(200, searchResponse([node()])));
    service.configure({ token: "t" });
    await service.refresh();

    responses.push(json(405, { message: "Pull Request is not mergeable" }));
    const result = await service.merge(service.pullRequests()[0]);
    expect(result).toEqual({ ok: false, error: "Pull Request is not mergeable" });
    expect(service.pullRequests()).toHaveLength(1);
  });

  async function pull(): Promise<PullRequest> {
    return {
      id: "PR_1",
      repo: "kirkanos/kuma-glance",
      number: 12,
      title: "x",
      url: "",
      checks: "success",
      mergeable: "MERGEABLE",
      isDraft: false,
      labels: [],
      major: false,
    };
  }
});
