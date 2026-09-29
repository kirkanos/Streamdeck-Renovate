import streamDeck from "@elgato/streamdeck";
import { DialQueueAction } from "./actions/dial";
import { QueueAction, type QueueSettings } from "./actions/queue";
import { DEFAULT_AUTHOR, DEFAULT_OWNER, github, type GitHubSettings } from "./github/service";

type JsonValue = Parameters<typeof streamDeck.ui.sendToPropertyInspector>[0];

streamDeck.logger.setLevel("info");

const queue = new QueueAction();
const dial = new DialQueueAction();

streamDeck.actions.registerAction(queue);
streamDeck.actions.registerAction(dial);

// Keep every visible key and dial in sync with GitHub.

function refreshAll(): void {
  void queue.refresh();
  void dial.refresh();
}

github.on("prs", () => {
  refreshAll();
  // Property inspectors with a hot-reloading repository list pick this up.
  void sendRepos();
});

github.on("state", () => {
  streamDeck.logger.info(`github: ${github.state}${github.error ? ` (${github.error})` : ""}`);
  refreshAll();
  sendToPropertyInspector(statusMessage());
});

// Messages from the property inspectors (ui/*.html).

type UiMessage =
  | { event: "getRepos" | "getStatus" | "logout" }
  | { event: "saveToken"; token: string; owner?: string; author?: string };

streamDeck.ui.onSendToPlugin<UiMessage>(async (ev) => {
  const message = ev.payload;
  switch (message.event) {
    case "getRepos":
      await sendRepos();
      break;
    case "getStatus":
      sendToPropertyInspector(statusMessage());
      break;
    case "saveToken": {
      const token = message.token.trim();
      if (!token) {
        sendToPropertyInspector({ event: "saveToken", ok: false, error: "Please enter a token" });
        return;
      }
      await saveSettings({
        token,
        owner: (message.owner ?? "").trim() || undefined,
        author: (message.author ?? "").trim() || undefined,
      });
      sendToPropertyInspector({ event: "saveToken", ok: true });
      break;
    }
    case "logout":
      await saveSettings({ owner: github.settings.owner, author: github.settings.author });
      break;
  }
});

/**
 * Repositories for the filter list: those with open Renovate PRs right now
 * plus the ones already selected on the key (so a selection stays visible
 * after its PRs were merged).
 */
async function sendRepos(): Promise<void> {
  const action = streamDeck.ui.action;
  if (!action) {
    return;
  }
  const settings = (await action.getSettings().catch(() => ({}))) as QueueSettings;
  const repos = new Set([...github.repos(), ...(settings.repos ?? [])]);
  const items = [...repos].sort((a, b) => a.localeCompare(b)).map((repo) => ({ label: repo, value: repo }));
  sendToPropertyInspector({ event: "getRepos", items });
}

function statusMessage(): JsonValue {
  return {
    event: "status",
    state: github.state,
    error: github.error ?? "",
    configured: Boolean(github.settings.token),
    owner: github.settings.owner ?? "",
    author: github.settings.author ?? "",
    defaultOwner: DEFAULT_OWNER,
    defaultAuthor: DEFAULT_AUTHOR,
    login: github.login ?? "",
    prCount: github.pullRequests().length,
  };
}

function sendToPropertyInspector(payload: JsonValue): void {
  if (streamDeck.ui.action) {
    streamDeck.ui.sendToPropertyInspector(payload).catch(() => undefined);
  }
}

async function saveSettings(settings: GitHubSettings): Promise<void> {
  await streamDeck.settings.setGlobalSettings(settings);
  github.configure(settings);
  sendToPropertyInspector(statusMessage());
}

streamDeck.settings.onDidReceiveGlobalSettings<GitHubSettings>((ev) => github.configure(ev.settings));

await streamDeck.connect();
github.configure(await streamDeck.settings.getGlobalSettings<GitHubSettings>());
