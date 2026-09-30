# Streamdeck-Renovate

Stream Deck plugin `com.kirkanos.renovate`. Status: M1–M4 done, released 1.0.0.

## Goal

All open Renovate pull requests under `github.com/kirkanos` at a glance, merged from the deck without opening a browser.

## Keys & dials

- **Queue** key: number of open Renovate PRs. Green when every PR's checks pass, yellow while checks run, red when at least one check failed. Press enters browse mode (key shows one PR at a time, press = next), long press merges the PR shown. Falls back to the summary after 15 s without input (same idle rule as Termine).
- **Dial** (Stream Deck +): turn browses PRs, the touch strip shows repo, title and check status. Push merges, touch opens the PR in the browser.

## Data source & API

- GitHub GraphQL, one query for all repos:
  `search(query: "author:app/renovate is:pr is:open user:kirkanos", type: ISSUE, first: 50)` with `repository.nameWithOwner`, `title`, `number`, `url`, `mergeable`, `commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }`.
- Merge via REST `PUT /repos/{owner}/{repo}/pulls/{number}/merge` with `merge_method` from settings.
- Poll every 60 s, refresh immediately after a merge.

## Settings

- Fine-grained PAT: pull requests read/write, checks read, contents read (needed for merge), all `kirkanos` repos.
- Merge method: merge, squash or rebase (default squash).
- Optional repo filter (comma-separated), option to hide major updates (title contains "major" or label `major`).

## Open questions

- Confirm the Renovate author login: hosted Renovate app is `app/renovate`; a self-hosted bot would be a normal user login.
- Search API is limited to 30 requests per minute; fine at 60 s polling, but the dial must not trigger extra queries.
- Should a merge be blocked when `mergeable` is `CONFLICTING`? (Default: yes, show a warning on the key.)

## Milestones

- M1: Queue key with count and status color, GraphQL client, tests for status aggregation.
- M2: Browse mode and merge with confirmation via long press.
- M3: Dial and touch strip.
- M4: CI workflows, release `v1.0.0`.

## Scaffold

Copy the tooling from [Kuma Glance](https://github.com/kirkanos/kuma-glance) (`../Streamdeck-Uptime-Kuma`), not from Termine:

- `@elgato/streamdeck` ^3, `@elgato/cli`, TypeScript, rollup via `scripts/build.mjs` and `createRollupConfig()` from its `rollup.config.mjs`; `tsconfig` extends `@tsconfig/node20`, `moduleResolution: Bundler`, `customConditions: ["node"]`.
- Manifest: SDKVersion 3, Nodejs 24, `Software.MinimumVersion` 7.1, version `0.0.0.0` (the build fills it in).
- Layout: `plugin/` (manifest, `ui/`, `layouts/`, icons), `src/plugin.ts`, `src/actions/`, `src/<service>/`, `src/render/` (reuse `svg.ts` and `theme.ts`).
- Dev variant `<uuid>-dev` via `--dev`, `npm run link:dev`, `npm run watch:dev`.
- Settings pages: static HTML with vendored sdpi-components 4.0.1 in `plugin/ui/`.
- CI: `.github/workflows/ci.yml` (typecheck, vitest, pack, artifact) and `release.yml` (tag `v*`, `PLUGIN_VERSION`, `gh release create`).
- Tests: vitest for model and render code, like `render.test.ts` in Kuma Glance.
- Secrets live in the action settings, never in global settings. Passwords are exchanged for a token once and not stored.
- No license for now.
