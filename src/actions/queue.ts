import {
  action,
  type DidReceiveSettingsEvent,
  type KeyAction,
  type KeyDownEvent,
  type KeyUpEvent,
  SingletonAction,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import { IDLE_MS, LONG_PRESS_MS, resolveIndex, wrapIndex } from "../browse";
import { PLUGIN_ID } from "../config";
import { filterPullRequests, type PullRequest, summarize } from "../github/model";
import { DEFAULT_MERGE_METHOD, github, type MergeMethod } from "../github/service";
import { messageKey, prKey, queueKey } from "../render/keys";
import { showImage, updates } from "../throttle";

export type QueueSettings = {
  mergeMethod?: MergeMethod;
  /** Repositories ("owner/name") to show; empty = all. */
  repos?: string[];
  hideMajors?: boolean;
};

/** Image for keys and dials that cannot show the queue (no token, offline). */
export function unavailableImage(render: (title: string, subtitle: string) => string): string | undefined {
  if (github.state === "unconfigured") {
    return render("Add token", "see settings");
  }
  if (github.state === "error") {
    return render("Offline", github.error?.includes("credentials") ? "check token" : "check connection");
  }
  if (!github.isConnected) {
    return render("GitHub", "connecting…");
  }
  return undefined;
}

/** Pull requests shown by one key or dial, after its filter settings. */
export function queueOf(settings: QueueSettings): PullRequest[] {
  return filterPullRequests(github.pullRequests(), settings);
}

type KeyState = {
  mode: "summary" | "browse";
  index: number;
  selectedId?: string;
  busy: boolean;
  longPressed: boolean;
  pressTimer?: ReturnType<typeof setTimeout>;
  idleTimer?: ReturnType<typeof setTimeout>;
};

/**
 * Queue key: the number of open Renovate PRs, colored by their checks.
 * Pressing it enters browse mode (one PR per key, press = next); holding the
 * key for {@link LONG_PRESS_MS} merges the PR shown. Without input the key
 * returns to the summary after {@link IDLE_MS}.
 */
@action({ UUID: `${PLUGIN_ID}.queue` })
export class QueueAction extends SingletonAction<QueueSettings> {
  readonly #settings = new Map<string, QueueSettings>();
  readonly #state = new Map<string, KeyState>();

  override onWillAppear(ev: WillAppearEvent<QueueSettings>): Promise<void> {
    this.#settings.set(ev.action.id, ev.payload.settings);
    this.#state.set(ev.action.id, { mode: "summary", index: -1, busy: false, longPressed: false });
    return this.#render(ev.action.id);
  }

  override onWillDisappear(ev: WillDisappearEvent<QueueSettings>): void {
    const state = this.#state.get(ev.action.id);
    clearTimeout(state?.pressTimer);
    clearTimeout(state?.idleTimer);
    this.#settings.delete(ev.action.id);
    this.#state.delete(ev.action.id);
    updates.forget(ev.action.id);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<QueueSettings>): Promise<void> {
    this.#settings.set(ev.action.id, ev.payload.settings);
    return this.#render(ev.action.id);
  }

  override onKeyDown(ev: KeyDownEvent<QueueSettings>): void {
    const state = this.#state.get(ev.action.id);
    if (!state || state.busy) {
      return;
    }
    clearTimeout(state.idleTimer);
    clearTimeout(state.pressTimer);
    state.longPressed = false;
    state.pressTimer = setTimeout(() => {
      state.pressTimer = undefined;
      state.longPressed = true;
      void this.#longPress(ev.action);
    }, LONG_PRESS_MS);
  }

  override async onKeyUp(ev: KeyUpEvent<QueueSettings>): Promise<void> {
    const state = this.#state.get(ev.action.id);
    if (!state || state.busy) {
      return;
    }
    clearTimeout(state.pressTimer);
    state.pressTimer = undefined;
    if (state.longPressed) {
      state.longPressed = false;
      return;
    }
    await this.#shortPress(ev.action);
  }

  /** Re-renders all visible keys. */
  async refresh(): Promise<void> {
    for (const id of this.#settings.keys()) {
      await this.#render(id);
    }
  }

  /** Summary → enter browse mode; browse mode → next pull request. */
  async #shortPress(key: KeyAction<QueueSettings>): Promise<void> {
    const state = this.#state.get(key.id);
    const settings = this.#settings.get(key.id);
    if (!state || !settings || !github.isConnected) {
      return;
    }
    const prs = queueOf(settings);
    if (prs.length === 0) {
      state.mode = "summary";
      await this.#render(key.id);
      return;
    }
    if (state.mode === "summary") {
      state.mode = "browse";
      state.index = 0;
    } else {
      state.index = wrapIndex(resolveIndex(prs, state.selectedId, state.index), 1, prs.length);
    }
    state.selectedId = prs[state.index]?.id;
    this.#armIdle(key.id);
    await this.#render(key.id);
  }

  /** Browse mode → merge the pull request shown; summary → enter browse mode. */
  async #longPress(key: KeyAction<QueueSettings>): Promise<void> {
    const state = this.#state.get(key.id);
    const settings = this.#settings.get(key.id);
    if (!state || !settings || !github.isConnected) {
      return;
    }
    if (state.mode !== "browse") {
      await this.#shortPress(key);
      return;
    }

    const prs = queueOf(settings);
    const pr = prs[resolveIndex(prs, state.selectedId, state.index)];
    if (!pr) {
      await key.showAlert();
      return;
    }
    if (pr.mergeable === "CONFLICTING") {
      streamDeck.logger.warn(`refusing to merge ${pr.repo}#${pr.number}: merge conflicts`);
      await key.showAlert();
      this.#armIdle(key.id);
      return;
    }

    state.busy = true;
    showImage(key, messageKey("Merging…", `#${pr.number}`));
    const result = await github.merge(pr, settings.mergeMethod ?? DEFAULT_MERGE_METHOD);
    state.busy = false;

    if (result.ok) {
      streamDeck.logger.info(`merged ${pr.repo}#${pr.number}`);
      await key.showOk();
    } else {
      streamDeck.logger.warn(`merge of ${pr.repo}#${pr.number} failed: ${result.error}`);
      await key.showAlert();
    }
    this.#armIdle(key.id);
    await this.#render(key.id);
  }

  #armIdle(actionId: string): void {
    const state = this.#state.get(actionId);
    if (!state) {
      return;
    }
    clearTimeout(state.idleTimer);
    state.idleTimer = setTimeout(() => {
      state.idleTimer = undefined;
      state.mode = "summary";
      void this.#render(actionId);
    }, IDLE_MS);
  }

  async #render(actionId: string): Promise<void> {
    const key = this.actions.find((a) => a.id === actionId) as KeyAction<QueueSettings> | undefined;
    const settings = this.#settings.get(actionId);
    const state = this.#state.get(actionId);
    if (!key || !settings || !state || state.busy) {
      return;
    }

    const unavailable = unavailableImage(messageKey);
    if (unavailable) {
      showImage(key, unavailable);
      return;
    }

    const prs = queueOf(settings);
    if (state.mode === "browse") {
      const index = resolveIndex(prs, state.selectedId, state.index);
      const pr = prs[index];
      if (pr) {
        state.index = index;
        state.selectedId = pr.id;
        showImage(key, prKey({ ...pr, position: index + 1, total: prs.length }));
        return;
      }
      state.mode = "summary";
      clearTimeout(state.idleTimer);
    }
    showImage(key, queueKey(summarize(prs), prs));
  }
}
