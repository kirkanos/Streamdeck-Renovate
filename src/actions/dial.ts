import streamDeck, {
  action,
  type DialAction,
  type DialDownEvent,
  type DialRotateEvent,
  type DidReceiveSettingsEvent,
  SingletonAction,
  type TouchTapEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import { resolveIndex, wrapIndex } from "../browse";
import { PLUGIN_ID } from "../config";
import { summarize } from "../github/model";
import { DEFAULT_MERGE_METHOD, github } from "../github/service";
import { dialCanvas, dialMessage, dialSummary } from "../render/dial";
import { updates } from "../throttle";
import { type QueueSettings, queueOf, unavailableImage } from "./queue";

/** How long "Merged" / "Failed" stays on the touch strip. */
const FLASH_MS = 1500;

type DialState = {
  /** -1 = summary, otherwise the position in the filtered queue. */
  index: number;
  selectedId?: string;
  busy: boolean;
  flash?: { canvas: string; until: number; timer: ReturnType<typeof setTimeout> };
};

/**
 * Dial (Stream Deck +): turning browses the open Renovate PRs, the touch
 * strip shows repository, title and check state. Pushing the dial merges the
 * PR shown, tapping the strip opens it in the browser. Browsing only uses the
 * list from the last poll, so it never triggers extra GitHub requests.
 */
@action({ UUID: `${PLUGIN_ID}.dial` })
export class DialQueueAction extends SingletonAction<QueueSettings> {
  readonly #settings = new Map<string, QueueSettings>();
  readonly #state = new Map<string, DialState>();

  override onWillAppear(ev: WillAppearEvent<QueueSettings>): Promise<void> {
    this.#settings.set(ev.action.id, ev.payload.settings);
    this.#state.set(ev.action.id, { index: -1, busy: false });
    return this.#render(ev.action.id);
  }

  override onWillDisappear(ev: WillDisappearEvent<QueueSettings>): void {
    clearTimeout(this.#state.get(ev.action.id)?.flash?.timer);
    this.#settings.delete(ev.action.id);
    this.#state.delete(ev.action.id);
    updates.forget(ev.action.id);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<QueueSettings>): Promise<void> {
    this.#settings.set(ev.action.id, ev.payload.settings);
    return this.#render(ev.action.id);
  }

  override async onDialRotate(ev: DialRotateEvent<QueueSettings>): Promise<void> {
    const state = this.#state.get(ev.action.id);
    const settings = this.#settings.get(ev.action.id);
    if (!state || !settings || state.busy || !github.isConnected) {
      return;
    }
    const prs = queueOf(settings);
    if (prs.length === 0) {
      return;
    }
    const current = state.index < 0 ? -1 : resolveIndex(prs, state.selectedId, state.index);
    // From the summary the first tick lands on the first (or last) PR.
    const delta = Math.sign(ev.payload.ticks);
    state.index = current < 0 ? wrapIndex(0, delta > 0 ? 0 : -1, prs.length) : wrapIndex(current, delta, prs.length);
    state.selectedId = prs[state.index]?.id;
    await this.#render(ev.action.id);
  }

  override async onDialDown(ev: DialDownEvent<QueueSettings>): Promise<void> {
    const state = this.#state.get(ev.action.id);
    const settings = this.#settings.get(ev.action.id);
    if (!state || !settings || state.busy || !github.isConnected) {
      return;
    }
    const pr = this.#current(ev.action.id);
    if (!pr) {
      await ev.action.showAlert();
      return;
    }
    if (pr.mergeable === "CONFLICTING") {
      streamDeck.logger.warn(`refusing to merge ${pr.repo}#${pr.number}: merge conflicts`);
      this.#flash(ev.action, dialMessage("Not merged", `#${pr.number} has conflicts`));
      await ev.action.showAlert();
      return;
    }

    state.busy = true;
    updates.update(ev.action.id, dialMessage("Merging…", `#${pr.number} ${pr.repo}`), (canvas) => ev.action.setFeedback({ canvas }));
    const result = await github.merge(pr, settings.mergeMethod ?? DEFAULT_MERGE_METHOD);
    state.busy = false;

    if (result.ok) {
      streamDeck.logger.info(`merged ${pr.repo}#${pr.number}`);
      this.#flash(ev.action, dialMessage("Merged", `#${pr.number} ${pr.repo}`));
    } else {
      streamDeck.logger.warn(`merge of ${pr.repo}#${pr.number} failed: ${result.error}`);
      this.#flash(ev.action, dialMessage("Not merged", result.error));
      await ev.action.showAlert();
    }
  }

  override async onTouchTap(ev: TouchTapEvent<QueueSettings>): Promise<void> {
    const pr = this.#current(ev.action.id);
    if (pr?.url) {
      await streamDeck.system.openUrl(pr.url);
    } else {
      await ev.action.showAlert();
    }
  }

  /** Re-renders all visible dials. */
  async refresh(): Promise<void> {
    for (const id of this.#settings.keys()) {
      await this.#render(id);
    }
  }

  #current(actionId: string) {
    const state = this.#state.get(actionId);
    const settings = this.#settings.get(actionId);
    if (!state || !settings || state.index < 0) {
      return undefined;
    }
    const prs = queueOf(settings);
    return prs[resolveIndex(prs, state.selectedId, state.index)];
  }

  /** Shows `canvas` for a moment, then returns to the normal image. */
  #flash(dial: DialAction<QueueSettings>, canvas: string): void {
    const state = this.#state.get(dial.id);
    if (!state) {
      return;
    }
    clearTimeout(state.flash?.timer);
    state.flash = {
      canvas,
      until: Date.now() + FLASH_MS,
      timer: setTimeout(() => {
        state.flash = undefined;
        void this.#render(dial.id);
      }, FLASH_MS),
    };
    void this.#render(dial.id);
  }

  async #render(actionId: string): Promise<void> {
    const dial = this.actions.find((a) => a.id === actionId);
    const settings = this.#settings.get(actionId);
    const state = this.#state.get(actionId);
    if (!dial?.isDial() || !settings || !state || state.busy) {
      return;
    }

    let canvas: string | undefined;
    if (state.flash && state.flash.until > Date.now()) {
      canvas = state.flash.canvas;
    } else {
      canvas = unavailableImage(dialMessage);
    }

    if (!canvas) {
      const prs = queueOf(settings);
      const index = state.index < 0 ? -1 : resolveIndex(prs, state.selectedId, state.index);
      const pr = prs[index];
      if (pr) {
        state.index = index;
        state.selectedId = pr.id;
        canvas = dialCanvas({ ...pr, position: index + 1, total: prs.length });
      } else {
        state.index = -1;
        state.selectedId = undefined;
        canvas = dialSummary(summarize(prs), prs);
      }
    }
    updates.update(dial.id, canvas, (value) => dial.setFeedback({ canvas: value }));
  }
}
