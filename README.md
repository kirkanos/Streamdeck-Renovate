# Renovate Queue

All open [Renovate](https://docs.renovatebot.com/) pull requests across your GitHub repositories at a glance on your Elgato Stream Deck, merged without opening a browser.

Unofficial plugin, not affiliated with Renovate (Mend) or GitHub.

## Features

* **Queue** key: the number of open Renovate pull requests, with the combined status of their checks as background color: 🟩 all checks passed, 🟨 checks still running, 🟥 at least one check failed. A row of dots shows the state of each pull request.
  * Press the key to **browse**: it shows one pull request at a time (repository, title, position, check status); every press moves to the next one.
  * **Hold** the key (0.6 s) to **merge** the pull request shown.
  * Pull requests with merge conflicts are shown with a warning and are never merged.
  * After 15 s without input the key returns to the summary.
* **Dial Queue** (Stream Deck + / + XL): turn the dial to browse the pull requests, the touch strip shows repository, title and check status. Push the dial to merge the pull request shown, tap the touch strip to open it in the browser.
* Per key / dial: merge method (squash, merge commit, rebase), a repository filter and an option to hide major version updates.
* One GitHub GraphQL search per minute covers all repositories; browsing uses the cached list and never triggers extra requests. The list is refreshed right after a merge.

## Installation

Download the [latest release](https://github.com/kirkanos/Streamdeck-Renovate/releases/latest) and open `com.kirkanos.renovate.streamDeckPlugin`. Requires Stream Deck 7.1 or newer.

Then add a Queue key (or a Dial Queue on a Stream Deck +), open its settings and save your GitHub token (see below). The token is shared by all keys and dials of the plugin.

## Settings

### GitHub token

The plugin needs a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new):

1. **Token name**: e.g. `Stream Deck Renovate Queue`; pick an expiration you are comfortable with.
2. **Resource owner**: the user or organization whose repositories Renovate updates (`kirkanos` by default).
3. **Repository access**: *All repositories*, or only the repositories with Renovate.
4. **Repository permissions**:
   * **Pull requests**: *Read and write* (list and merge the pull requests)
   * **Contents**: *Read and write* (merging writes to the default branch)
   * **Commit statuses**: *Read-only* (check status of the pull requests)
   * **Checks**: *Read-only*, if your token page offers it (check runs of GitHub Actions; not every account sees this permission)
   * **Metadata**: *Read-only* (selected automatically)

Paste the token into the key settings and press *Save*. It is stored in the plugin's global settings and only sent to `api.github.com`. *Remove token* deletes it again.

Two more fields in the same section rarely need a change:

* **User / org**: the account searched for Renovate pull requests (`kirkanos` by default). Must match the resource owner of the token.
* **Renovate author**: the search author of the pull requests. `app/renovate` (default) for the hosted Renovate GitHub app; for a self-hosted Renovate use the bot's user name.

### Key and dial settings

* **Merge method**: squash (default), merge commit or rebase. GitHub refuses methods that are disabled in the repository settings; the key then shows an alert.
* **Repositories**: the repositories with open Renovate pull requests, as checkboxes. Nothing selected means all repositories.
* **Hide major version updates**: leaves out pull requests that Renovate marks as major update (in the update table of the PR body, a `major` label or "major" in the title).

## Prerequisites

* Renovate must open pull requests in the repositories, either the [hosted GitHub app](https://github.com/apps/renovate) or a self-hosted instance.
* The plugin merges through the GitHub API like the *Merge* button does: branch protection rules, required checks and required reviews still apply, and GitHub reports why a merge was refused in the plugin log.

## Development

Renovate Queue is a Node.js plugin built with the official [Stream Deck SDK](https://docs.elgato.com/streamdeck/sdk/introduction/getting-started/) (`@elgato/streamdeck`, TypeScript, rollup). The settings pages use [sdpi-components](https://sdpi-components.dev). GitHub is accessed with plain `fetch`; there are no other runtime dependencies.

| Path | Content |
| --- | --- |
| `src/actions/` | One class per Stream Deck action (Queue key, Dial Queue) |
| `src/github/` | GraphQL search / REST merge client and the pull request model |
| `src/render/` | SVG images for keys and touch strips |
| `src/browse.ts` | Browse mode helpers (index wrapping, long press and idle timings) |
| `plugin/` | Static plugin files: manifest, icons, settings pages (`ui/`), dial layout |
| `assets/` | Plugin icon source (rendered to PNG by the build) |
| `scripts/` | Build script |

```sh
npm install
npm test               # unit tests
npm run typecheck

# Development: a parallel-installable copy "Renovate Queue (dev)"
npm run link:dev       # build + link into Stream Deck (once)
npm run watch:dev      # rebuild and restart the plugin on every change

npm run validate       # build and validate the plugin folder
npm run pack           # Release/com.kirkanos.renovate.streamDeckPlugin
```

Linking and restarting need the Stream Deck developer mode (`npx streamdeck dev`, then restart the Stream Deck app once). Plugin logs are written to `dist/<plugin id>.sdPlugin/logs/`.

GitHub Actions builds and tests every push (`.github/workflows/ci.yml`) and publishes a release with the packed plugin for tags like `v1.0.0` (`.github/workflows/release.yml`).

## Troubleshooting

* **Keys show "Add token":** open the key settings and save a GitHub token.
* **Keys show "Offline / check token":** the token was rejected; it may have expired or lacks the permissions above. Save a new one.
* **Keys show "Offline / check connection":** GitHub is not reachable from this computer or the API rate limit was hit; the plugin keeps retrying every minute.
* **Merge shows an alert:** the pull request has conflicts, is a draft, or GitHub refused the merge (branch protection, disabled merge method). Details are in the plugin log.
* Anything else: [open an issue](https://github.com/kirkanos/Streamdeck-Renovate/issues).
