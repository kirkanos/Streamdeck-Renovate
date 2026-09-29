/**
 * Shared "GitHub" section of the property inspectors.
 *
 * The plugin owns the connection: this page sends the token once
 * ({ event: "saveToken" }) and shows the status the plugin reports back
 * ({ event: "status" }). The token is kept in the plugin's global settings.
 */
(function () {
  const client = SDPIComponents.streamDeckClient;
  const $ = (id) => document.getElementById(id);

  const STATE_TEXT = {
    connected: "Connected",
    connecting: "Connecting…",
    error: "Connection problem",
    unconfigured: "No token",
  };

  function send(payload) {
    client.send("sendToPlugin", payload);
  }

  function showMessage(text, kind) {
    const box = $("gh-message");
    box.textContent = text || "";
    box.className = `message ${kind || ""}`;
    box.hidden = !text;
  }

  function renderStatus(status) {
    const badge = $("gh-status");
    badge.className = `status ${status.state}`;
    $("gh-status-text").textContent = STATE_TEXT[status.state] || status.state;

    const owner = status.owner || status.defaultOwner;
    let detail = "";
    if (status.error) {
      detail = status.error;
    } else if (status.state === "connected") {
      detail = `${status.login ? `${status.login} · ` : ""}${owner} · ${status.prCount} open Renovate PR${status.prCount === 1 ? "" : "s"}`;
    } else if (status.configured) {
      detail = owner;
    }
    $("gh-status-detail").textContent = detail;

    $("gh-login").hidden = status.configured;
    $("gh-logout").hidden = !status.configured;
    for (const el of document.querySelectorAll(".requires-token")) {
      el.hidden = !status.configured;
    }
    if (!status.configured) {
      if (!$("gh-owner").value) {
        $("gh-owner").value = status.owner || "";
      }
      if (!$("gh-author").value) {
        $("gh-author").value = status.author || "";
      }
      $("gh-owner").placeholder = status.defaultOwner || "";
      $("gh-author").placeholder = status.defaultAuthor || "";
    }
  }

  client.sendToPropertyInspector.subscribe((message) => {
    const payload = message.payload || {};
    if (payload.event === "status") {
      renderStatus(payload);
    } else if (payload.event === "saveToken") {
      $("gh-save").disabled = false;
      if (payload.ok) {
        showMessage("Token saved", "success");
        $("gh-token").value = "";
      } else {
        showMessage(payload.error, "error");
      }
    }
  });

  const TEMPLATE = `
    <sdpi-item label="GitHub">
      <div id="gh-status" class="status unconfigured">
        <div><strong id="gh-status-text">…</strong><span id="gh-status-detail"></span></div>
      </div>
    </sdpi-item>
    <div id="gh-message" class="message" hidden></div>
    <div id="gh-login" hidden>
      <sdpi-item label="Token"><sdpi-password id="gh-token" placeholder="github_pat_…"></sdpi-password></sdpi-item>
      <sdpi-item label="User / org"><sdpi-textfield id="gh-owner"></sdpi-textfield></sdpi-item>
      <sdpi-item label="Renovate author"><sdpi-textfield id="gh-author"></sdpi-textfield></sdpi-item>
      <sdpi-item><sdpi-button id="gh-save">Save</sdpi-button></sdpi-item>
      <p class="hint">
        Fine-grained personal access token with access to your repositories and the permissions
        Pull requests: read and write, Contents: read and write, Checks: read (see the README). The token
        is stored in the Stream Deck plugin settings and only sent to api.github.com.
      </p>
    </div>
    <div id="gh-logout" hidden>
      <sdpi-item><sdpi-button id="gh-remove">Remove token</sdpi-button></sdpi-item>
    </div>`;

  window.addEventListener("DOMContentLoaded", () => {
    $("gh-connection").innerHTML = TEMPLATE;

    $("gh-save").addEventListener("click", () => {
      const token = ($("gh-token").value || "").trim();
      if (!token) {
        showMessage("Please enter a token", "error");
        return;
      }
      showMessage("Saving…", "");
      $("gh-save").disabled = true;
      send({
        event: "saveToken",
        token,
        owner: ($("gh-owner").value || "").trim(),
        author: ($("gh-author").value || "").trim(),
      });
    });

    $("gh-remove").addEventListener("click", () => {
      showMessage("", "");
      send({ event: "logout" });
    });

    send({ event: "getStatus" });
  });
})();
