async function deskRequest(path, options = {}) {
  const { body, method = "GET" } = options;
  const response = await fetch(path, {
    method, cache: "no-store",
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    signal: AbortSignal.timeout(method === "GET" ? 15_000 : 85_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error ?? "The brief service is unavailable. Try again shortly.");
  return data;
}

const VERDICT_LABELS = {
  documented: "Documented",
  corroborated: "Independently corroborated",
  disputed: "Sources disagree",
  unverified: "Unverified",
};

const COMPARISON_LABELS = {
  supports: "Supporting evidence",
  contradicts: "Conflicting evidence",
  context: "Additional context",
  repeats: "Repeats the claim",
};

export function createBriefUI({ showReader, readerContent, escapeText, link, announce }) {
  const esc = escapeText;
  const action = (label, id, primary = false) =>
    '<button type="button" class="brief-button' + (primary ? " brief-primary" : "") +
    '" data-brief-action="' + id + '">' + label + "</button>";
  let activeStory;
  let settingsBack;

  function notice(container, value, tone = "") {
    const target = container.querySelector(".brief-notice");
    if (!target) return;
    target.textContent = value;
    target.dataset.tone = tone;
  }

  function reference(source, index) {
    return '<a class="brief-citation" href="' + link(source.url) + '" target="_blank" rel="noopener noreferrer" aria-label="Source ' +
      index + ", " + esc(source.publisher) + '">' + index + "</a>";
  }

  function factChecks(brief, sources, cite) {
    if (!Array.isArray(brief.verification)) {
      return '<p class="brief-muted">This saved brief used feed excerpts. Run a fact check to review original documents and related coverage.</p>' +
        '<ul class="brief-checks">' + brief.checks.map(check => '<li><span class="brief-evidence-label">' + esc(check.label) + '</span><p>' +
          esc(check.statement) + cite([check.sourceId]) + '</p><details class="brief-quote"><summary>Supporting excerpt</summary><blockquote>' +
          esc(check.quote) + "</blockquote></details></li>").join("") + "</ul>";
    }
    function quote(entry, heading) {
      const source = sources.get(entry.sourceId);
      const attribution = [source?.publisher, source?.scope, entry.label].filter(Boolean).map(esc).join(" · ");
      return '<div class="claim-quote"><strong>' + esc(heading) + "</strong><blockquote>" + esc(entry.quote) +
        '</blockquote><p>' + attribution + cite([entry.sourceId]) + "</p></div>";
    }
    return '<ul class="brief-checks claim-checks">' + brief.verification.map(check => {
      const status = Object.hasOwn(VERDICT_LABELS, check.status) ? check.status : "unverified";
      const evidence = check.comparisons.map(item => quote(item, COMPARISON_LABELS[item.relation] ?? "Related evidence")).join("");
      return '<li><span class="claim-status" data-status="' + status + '">' + VERDICT_LABELS[status] + '</span><p class="claim-text">' +
        esc(check.statement) + cite([check.claim.sourceId]) + '</p><p class="claim-reason">' + esc(check.reason) +
        '</p><details class="claim-details"' + (status === "disputed" ? " open" : "") + '><summary>Compare evidence</summary><div class="claim-quotes">' +
        quote(check.claim, "Claim source") + evidence + "</div></details></li>";
    }).join("") + "</ul>";
  }

  function renderBrief(brief) {
    const sourceById = new Map(brief.sources.map((source, index) => [source.id, { ...source, index: index + 1 }]));
    const cite = ids => ids.map(id => sourceById.get(id)).filter(Boolean)
      .map(source => reference(source, source.index)).join("");
    const section = (label, entries, emptyText) => '<section class="brief-section"><h4>' + label + "</h4>" +
      (entries.length ? entries.map(entry => '<p>' + esc(entry.text) + cite(entry.sources) + "</p>").join("") :
        "<p class=\"brief-muted\">" + emptyText + "</p>") + "</section>";
    const originals = brief.sources.map(source => '<li><a href="' + link(source.url) +
      '" target="_blank" rel="noopener noreferrer">' + esc(source.title) + '</a><small>' +
      esc(source.publisher) + (source.scope ? " · " + esc(source.scope) : "") +
      (source.date ? " · " + esc(new Date(source.date).toLocaleDateString()) : "") + "</small></li>").join("");
    const written = new Date(brief.createdAt).toLocaleDateString();
    const originalCount = brief.sources.filter(source => ["Original document", "Original abstract"].includes(source.scope)).length;
    const feedCount = brief.sources.length - originalCount;
    const scope = brief.verification ?
      [originalCount && originalCount + " original " + (originalCount === 1 ? "source" : "sources"),
        feedCount && feedCount + " feed " + (feedCount === 1 ? "excerpt" : "excerpts")].filter(Boolean).join(" · ") :
      "Publisher feed excerpts";
    return '<div class="brief-metadata">Generated ' + esc(written) + " · " + esc(scope) + "</div>" +
      section("Quick summary", brief.quick, "Details are limited in the available excerpts.") +
      '<section class="brief-section"><h4>Fact checks</h4>' + factChecks(brief, sourceById, cite) + "</section>" +
      section("Why it matters", brief.impact, "The available excerpts give limited evidence of practical impact.") +
      section("Detailed explanation", brief.details, "The available excerpts give limited technical detail.") +
      section("Comparison", brief.comparison, "A comparable baseline is unavailable in these excerpts.") +
      (brief.uncertainties.length ? section("Open questions", brief.uncertainties, "") : "") +
      '<section class="brief-section"><h4>Original sources</h4><ol class="coverage brief-originals">' + originals + "</ol></section>" +
      '<p class="brief-metadata">Extracted with ' + esc(brief.models.extract.model) + " · Written with " + esc(brief.models.write.model) + "</p>";
  }

  function paintStory(entry) {
    if (!entry.panel.isConnected) return;
    const label = entry.brief ? (entry.brief.verification ? "Check for updates" : "Run fact check") : "Generate brief";
    entry.panel.innerHTML = '<div class="brief-top"><h3>AI brief</h3><div class="brief-actions">' +
      action(label, "generate", !entry.brief) + action("Model settings", "settings") + "</div></div>" +
      (entry.brief ? renderBrief(entry.brief) :
        '<p class="brief-muted">Get a cited summary with original documents and related coverage where available. Generation uses your configured API accounts.</p>') +
      '<p class="brief-notice" role="status"></p>';
    if (entry.loading) notice(entry.panel, "Checking for a saved brief…");
  }

  function attach(panel, storyId, back) {
    const entry = { panel, storyId, back, brief: null, loading: true };
    activeStory = entry;
    paintStory(entry);
    panel.querySelector('[data-brief-action="generate"]').disabled = true;
    deskRequest("/api/brief?story=" + encodeURIComponent(storyId)).then(data => {
      if (panel.isConnected) entry.brief = data.brief;
    }).catch(error => {
      if (panel.isConnected) entry.readError = error.message;
    }).finally(() => {
      entry.loading = false;
      paintStory(entry);
      if (entry.readError) notice(panel, entry.readError, "error");
    });
  }

  function providerOptions(providers, selected, connectedOnly = false) {
    const options = providers.filter(provider => !connectedOnly || provider.connected).map(provider =>
      '<option value="' + esc(provider.id) + '"' + (provider.id === selected ? " selected" : "") + ">" + esc(provider.name) + "</option>");
    if (!options.length) return '<option value="">Connect a provider first</option>';
    return options.join("");
  }

  function stageSettingsMarkup(data, slot, title, description) {
    const existing = data.settings?.[slot];
    return '<fieldset class="model-stage"><legend>' + title + '</legend><p>' + description + '</p><div class="model-fields">' +
      '<label>Provider<select name="' + slot + '-provider" required>' + providerOptions(data.providers, existing?.provider, true) +
      '</select></label><label>Model ID<input type="text" name="' + slot + '-model" value="' + esc(existing?.model ?? "") +
      '" maxlength="120" autocomplete="off" spellcheck="false" placeholder="Provider’s exact model ID" required></label></div></fieldset>';
  }

  function paintSettings(panel, data, message = "") {
    if (!panel.isConnected) return;
    const connections = data.providers.map(provider =>
      '<li class="model-connection"><div><strong>' + esc(provider.name) + '</strong><small data-connected="' + provider.connected + '">' +
      (provider.connected ? "Connected" : "Disconnected") + "</small></div>" +
      (provider.connected ? '<button type="button" class="brief-button" data-disconnect="' + esc(provider.id) +
        '" aria-label="Disconnect ' + esc(provider.name) + '">Disconnect</button>' : "") + "</li>").join("");
    const hasProvider = data.providers.some(provider => provider.connected);
    panel.innerHTML = '<h3>Provider connections</h3><ul class="model-connections">' + connections + '</ul>' +
      '<form class="model-form" data-model-form="connect" autocomplete="off">' +
      '<div class="model-fields"><label>Provider<select name="provider">' + providerOptions(data.providers) + '</select></label>' +
      '<label>API key<input type="password" name="key" maxlength="500" autocomplete="off" spellcheck="false" required></label></div>' +
      '<button class="brief-button brief-primary" type="submit">Connect or replace key</button></form>' +
      '<h3 class="models-heading">Brief models</h3><form class="model-form" data-model-form="models">' +
      '<div class="model-stages">' +
      stageSettingsMarkup(data, "extract", "Fact extraction", "Choose an inexpensive structured-output model.") +
      stageSettingsMarkup(data, "write", "Brief writing", "Choose the model that will write from the extracted evidence.") + '</div>' +
      '<div class="model-limit"><label>Daily brief limit<input type="number" name="daily-limit" min="1" max="30" value="' +
      esc(data.dailyLimit) + '" required></label><p>' + esc(data.attempts) + " used in the last 24 hours. A new brief may make two paid model calls.</p></div>" +
      '<button class="brief-button brief-primary" type="submit"' + (hasProvider ? "" : " disabled") + '>Save models</button></form>' +
      '<p class="brief-notice" role="status"></p>';
    if (message) notice(panel, message);
  }

  async function openSettings(back) {
    settingsBack = typeof back === "function" ? back : null;
    showReader('<h2 id="reader-heading">Model settings</h2>' +
      '<p class="model-intro">Connect your own API accounts. Keys are encrypted before storage and sent only to their respective providers.</p>' +
      (settingsBack ? '<div class="brief-actions settings-back">' + action("Back to story", "back") + "</div>" : "") +
      '<section id="brief-settings-panel" class="model-settings"><p class="brief-notice" role="status">Loading model settings…</p></section>', "Settings");
    const panel = readerContent.querySelector("#brief-settings-panel");
    try {
      paintSettings(panel, await deskRequest("/api/brief-settings"));
    } catch (error) {
      notice(panel, error.message, "error");
      panel.insertAdjacentHTML("beforeend", action("Try again", "reload-settings"));
    }
  }

  async function saveSettings(panel, call, message) {
    if (panel.dataset.pending) return;
    panel.dataset.pending = "true";
    const buttons = [...panel.querySelectorAll("button")].filter(button => !button.disabled);
    for (const button of buttons) button.disabled = true;
    notice(panel, "Checking with your provider…");
    try {
      paintSettings(panel, await call(), message);
      announce(message);
    } catch (error) {
      notice(panel, error.name === "TimeoutError" ? "The provider did not respond in time." : error.message, "error");
    } finally {
      delete panel.dataset.pending;
      for (const button of buttons) button.disabled = false;
    }
  }

  async function generate(button, entry) {
    if (!entry?.panel.isConnected || entry.pending) return;
    const panel = entry.panel;
    entry.pending = true;
    button.disabled = true;
    notice(panel, "Checking configured models…");
    try {
      const status = await deskRequest("/api/brief-settings");
      if (!status.ready) {
        notice(panel, "Connect a provider and choose both models in Model settings.", "error");
        return;
      }
      notice(panel, "Opening original sources, checking claims, and writing the brief…");
      const data = await deskRequest("/api/brief", { method: "POST", body: { story: entry.storyId } });
      entry.brief = data.brief;
      paintStory(entry);
      notice(panel, data.cached ? "The saved brief is current." : "Your brief is ready.");
      announce(data.cached ? "The saved brief is current." : "Your brief is ready.");
    } catch (error) {
      notice(panel, error.name === "TimeoutError" ? "The request timed out. Reopen the story to check for a saved brief." : error.message, "error");
    } finally {
      entry.pending = false;
      button.disabled = false;
    }
  }

  readerContent.addEventListener("submit", event => {
    const form = event.target.closest("[data-model-form]");
    if (!form) return;
    event.preventDefault();
    const panel = form.closest("#brief-settings-panel");
    const data = new FormData(form);
    if (form.dataset.modelForm === "connect") {
      const key = String(data.get("key") ?? "");
      form.elements.key.value = "";
      const body = { provider: data.get("provider"), key };
      saveSettings(panel, () => deskRequest("/api/model-connections", { method: "POST", body }), "Provider connected.");
    } else {
      const body = {
        extract: { provider: data.get("extract-provider"), model: data.get("extract-model") },
        write: { provider: data.get("write-provider"), model: data.get("write-model") },
        dailyLimit: Number(data.get("daily-limit")),
      };
      saveSettings(panel, () => deskRequest("/api/brief-settings", { method: "POST", body }), "Models saved.");
    }
  });

  readerContent.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button) return;
    const task = button.dataset.briefAction;
    if (task === "settings") openSettings(activeStory?.back);
    if (task === "reload-settings") openSettings(settingsBack);
    if (task === "back") settingsBack?.();
    if (task === "generate") generate(button, activeStory);
    if (button.dataset.disconnect) {
      const panel = button.closest("#brief-settings-panel");
      const path = "/api/model-connections?provider=" + encodeURIComponent(button.dataset.disconnect);
      saveSettings(panel, () => deskRequest(path, { method: "DELETE" }), "Provider disconnected.");
    }
  });

  return { attach, openSettings };
}
