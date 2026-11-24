import { createBriefUI } from "./briefs.js?v=factcheck1";

const $ = selector => document.querySelector(selector);
const feed = $("#feed");
const reader = $("#reader");
const readerContent = $("#reader-content");
const searchForm = $("#search-form");
const searchInput = $("#search-input");
const searchClear = $("#search-clear");
const refreshButton = $("#refresh");
const CACHE_KEY = "model-desk.feed";
const SAVE_KEY = "model-desk.saved";
const DAY = 86_400_000;
const BATCH = 12;

function recover(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function remember(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function validPayload(value) {
  return value && Array.isArray(value.stories) && Array.isArray(value.sources) && value.topics;
}

const cached = recover(CACHE_KEY, null);
let payload = validPayload(cached) ? cached : null;
const recovered = recover(SAVE_KEY, []);
const saved = new Map((Array.isArray(recovered) ? recovered : [])
  .filter(story => story?.id && Array.isArray(story.articles)).map(story => [story.id, story]));

let view = "today";
let topic = "all";
let query = "";
let limit = BATCH;
let loading = true;
let offline = Boolean(payload);
let returnFocus;

const titles = {
  today: ["Today’s edition", "AI news ranked by impact, urgency, and quality of evidence."],
  latest: ["Latest stories", "Recent coverage, ordered by publication time."],
  saved: ["Saved stories", "Your reading list on this device."],
};

const bookmark = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v15l-6-4-6 4z"/></svg>';
const layers = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>';
const escapeText = value => String(value ?? "").replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

const longDate = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });
const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function localTime(iso) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toDateString() === new Date().toDateString() ? timeFormat.format(date) : shortDate.format(date);
}

function displayDate() {
  const date = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });
  const editionDate = $("#edition-date");
  editionDate.dateTime = formatter.format(date);
  editionDate.textContent = longDate.format(date);
}

function link(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? escapeText(parsed.href) : "#";
  } catch {
    return "#";
  }
}

function sourceName(id) {
  return payload?.sources.find(source => source.id === id)?.name ??
    ({ ars: "Ars Technica", verge: "The Verge", techreview: "MIT Technology Review", openai: "OpenAI", deepmind: "Google DeepMind",
      huggingface: "Hugging Face", simon: "Simon Willison", arxiv: "arXiv cs.AI" })[id] ?? "Source";
}

function findStory(id) {
  return payload?.stories.find(story => story.id === id) ?? saved.get(id);
}

function baseStories() {
  if (view === "saved") return [...saved.values()].reverse().map(story => findStory(story.id));
  const stories = payload?.stories ?? [];
  if (view === "latest") return [...stories].sort((a, b) => b.date.localeCompare(a.date));
  const cutoff = Date.now() - 3 * DAY;
  const recent = stories.filter(story => Date.parse(story.date) >= cutoff || story.priority?.urgency.points >= 4);
  return recent.length ? recent : stories;
}

function currentStories(stories) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return stories.filter(story => {
    if (topic !== "all" && story.topic !== topic) return false;
    if (!terms.length) return true;
    const haystack = [story.title, story.excerpt, payload?.topics[story.topic],
      ...story.articles.map(article => [article.title, article.excerpt, sourceName(article.source)].join(" "))].join(" ").toLowerCase();
    return terms.every(term => haystack.includes(term));
  });
}

function saveButton(story, withText = false) {
  const active = saved.has(story.id);
  return '<button class="save" type="button" data-save="' + escapeText(story.id) +
    '" aria-label="' + (active ? "Remove from saved" : "Save story") + '" aria-pressed="' + active + '">' +
    bookmark + (withText ? '<span>' + (active ? "Saved" : "Save") + "</span>" : "") + "</button>";
}

function coverageButton(story) {
  const count = Number(story.sourceCount);
  const label = count > 1 ? count + " sources" : "1 source";
  return '<button class="coverage-button" type="button" data-story="' + escapeText(story.id) +
    '" aria-label="Read coverage from ' + label + '">' + layers + label + "</button>";
}

function rankingLine(story) {
  if (view !== "today" || !story.priority) return "";
  const { impact, urgency, evidence } = story.priority;
  const reasons = [impact.label, urgency.points ? urgency.label : "", evidence.label].filter(Boolean);
  return '<p class="rank-reasons"><span class="sr-only">Why it ranks. </span>' + reasons.map(escapeText).join(" · ") + "</p>";
}

function rankingDetails(story) {
  if (!story.priority) return "";
  const rows = [["Impact", story.priority.impact], ["Urgency", story.priority.urgency], ["Evidence", story.priority.evidence]];
  return '<section class="reader-ranking"><h3>Why it ranks on Today</h3><dl>' +
    rows.map(([label, factor]) => "<dt>" + label + "</dt><dd>" + escapeText(factor.label) + "</dd>").join("") + "</dl></section>";
}

function renderStory(story, lead) {
  const meta = '<span class="category">' + escapeText(payload?.topics[story.topic] ?? "AI news") + '</span>';
  const time = '<time datetime="' + escapeText(story.date) + '">' + escapeText(localTime(story.date)) + '</time>';
  const tag = lead || (!query.trim() && (view !== "today" || topic !== "all")) ? "h2" : "h3";
  const title = "<" + tag + ' class="story-title"><button type="button" data-story="' + escapeText(story.id) + '">' +
    escapeText(story.title) + "</button></" + tag + ">";
  const excerpt = story.excerpt ? '<p class="story-excerpt">' + escapeText(story.excerpt) + "</p>" : "";
  const actions = '<div class="story-actions"><span>' + escapeText(sourceName(story.articles[0]?.source)) +
    "</span>" + coverageButton(story) + (lead ? saveButton(story, true) : "") + "</div>";
  const ranking = rankingLine(story);
  if (lead) return '<article class="lead"><div class="section-line">' + meta + time + "</div>" + title + excerpt + ranking + actions + "</article>";
  return '<article class="story-row"><div><div class="row-meta">' + meta + time + "</div>" + title + excerpt + ranking + actions + "</div>" +
    saveButton(story) + "</article>";
}

function empty(title, message, action, actionLabel) {
  return '<div class="empty"><h2>' + title + '</h2><p>' + message + "</p>" +
    (action ? '<button type="button" data-action="' + action + '">' + actionLabel + "</button>" : "") + "</div>";
}

function renderFeed() {
  const all = baseStories();
  const stories = currentStories(all);
  const featured = view === "today" && topic === "all" && !query.trim();
  feed.setAttribute("aria-busy", String(loading && !payload && view !== "saved"));
  if (loading && !payload && view !== "saved") return;
  if (!stories.length) {
    if (topic !== "all" || query.trim()) feed.innerHTML = empty("No matching stories", "Try another term or clear your filters.", "clear", "Clear filters");
    else if (view === "saved") feed.innerHTML = empty("Your reading list is empty", "Save any story to find it here later.", "today", "Browse today’s edition");
    else if (!payload || !payload.updatedAt) feed.innerHTML = empty("The feeds are unavailable", "The desk couldn’t reach its sources. Try refreshing in a moment.", "refresh", "Try again");
    else feed.innerHTML = empty("No recent stories", "The feeds are connected. Check back for new coverage.");
  } else {
    const lead = featured ? renderStory(stories[0], true) : "";
    const list = stories.slice(featured ? 1 : 0, limit);
    let heading = "";
    if (query.trim()) {
      heading = '<div class="list-heading"><h2>Search results</h2><span role="status">' +
        stories.length + (stories.length === 1 ? " story" : " stories") + "</span></div>";
    } else if (featured && list.length) {
      heading = '<div class="list-heading"><h2>More stories</h2><span>' + (stories.length - 1) + " stories</span></div>";
    }
    const more = limit < stories.length ? '<button type="button" class="more" data-action="more">Load more stories</button>' : "";
    feed.innerHTML = lead + heading + list.map(story => renderStory(story, false)).join("") + more;
  }
  const counts = new Map();
  for (const story of all) counts.set(story.topic, (counts.get(story.topic) ?? 0) + 1);
  $("#topics").innerHTML = [["all", "All topics"], ...Object.entries(payload?.topics ?? {})].map(([key, label]) =>
    '<button type="button" class="topic" data-topic="' + escapeText(key) + '" aria-pressed="' + (topic === key) +
    '"><span>' + escapeText(label) + "</span><span>" + (key === "all" ? all.length : counts.get(key) ?? 0) + "</span></button>").join("");
}

function renderSources() {
  $("#sources").innerHTML = (payload?.sources ?? []).slice(0, 5).map(source =>
    '<div class="source-row"><i aria-hidden="true" class="source-dot" data-state="' + escapeText(source.state) + '"></i><strong>' +
    escapeText(source.name) + "</strong><small>" + escapeText(source.type) + "</small></div>").join("");
}

function feedStatus() {
  const state = $("#feed-state");
  const liveCount = payload?.sources.filter(source => source.state === "live").length ?? 0;
  let text = "Connecting to feeds";
  let tone = "neutral";
  if (payload && offline) {
    text = "Showing cached coverage";
    tone = "warning";
  } else if (liveCount) {
    text = liveCount + " of " + payload.sources.length + " feeds live";
    tone = "live";
  } else if (!loading) {
    text = payload?.updatedAt ? "Showing cached coverage" : "Feeds unavailable";
    tone = "warning";
  }
  state.dataset.tone = tone;
  state.querySelector("span").textContent = text;
  state.title = payload?.updatedAt ? "Last successful feed check " + new Date(payload.updatedAt).toLocaleString() : "";
}

function announce(message) {
  $("#announcement").textContent = message;
}

async function load(announceResult = false) {
  if (refreshButton.disabled) return;
  refreshButton.disabled = true;
  loading = true;
  try {
    const response = await fetch("/api/news", { cache: "no-store", signal: AbortSignal.timeout(14_000) });
    if (!response.ok) throw new Error("Feed endpoint unavailable");
    const next = await response.json();
    if (!validPayload(next)) throw new Error("Invalid feed response");
    if (next.stories.length || !payload || next.updatedAt) {
      payload = next;
      if (next.updatedAt) remember(CACHE_KEY, next);
      offline = false;
    } else {
      offline = true;
    }
    if (announceResult) {
      const didCheck = next.sources.some(source => source.state === "live");
      announce(didCheck ? "Feed refreshed." : "Feed sources unavailable.");
    }
  } catch {
    offline = Boolean(payload);
    if (announceResult) announce("Couldn’t reach the news feed.");
  } finally {
    loading = false;
    refreshButton.disabled = false;
    displayDate();
    feedStatus();
    renderFeed();
    renderSources();
  }
}

function switchView(next) {
  view = next;
  topic = "all";
  resetSearch();
  const [title, deck] = titles[view];
  $("#edition-title").textContent = title;
  $("#edition-deck").textContent = deck;
  for (const button of document.querySelectorAll("[data-view]")) {
    if (button.dataset.view === view) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  renderFeed();
}

function showReader(content, label) {
  const wasOpen = reader.open;
  if (!wasOpen) returnFocus = document.activeElement;
  $("#reader-label").textContent = label;
  readerContent.innerHTML = content;
  if (!wasOpen) reader.showModal();
  else reader.querySelector("[data-close]").focus();
  reader.scrollTop = 0;
}

function openStory(story) {
  const source = sourceName(story.articles[0]?.source);
  const preview = story.excerpt ? '<div class="reader-preview"><h3>From ' + escapeText(source) + "</h3><p>" + escapeText(story.excerpt) + "</p></div>" : "";
  const coverage = story.articles.map(article => '<li><a target="_blank" rel="noopener noreferrer" href="' + link(article.url) +
    '">' + escapeText(article.title) + '</a><small>' + escapeText(sourceName(article.source)) + " · " +
    escapeText(shortDate.format(new Date(article.date))) + "</small></li>").join("");
  const content = '<div class="row-meta"><span class="category">' + escapeText(payload?.topics[story.topic] ?? "AI news") +
    '</span><time datetime="' + escapeText(story.date) + '">' + escapeText(localTime(story.date)) + '</time></div>' +
    '<h2 id="reader-heading">' + escapeText(story.title) + '</h2><div class="story-actions">' +
    saveButton(story, true) + '</div><section class="brief-panel" id="story-brief" aria-label="AI brief"></section>' +
    preview + '<h3>Original coverage</h3><ul class="coverage">' + coverage + "</ul>" + rankingDetails(story);
  showReader(content, "Story");
  briefUI.attach($("#story-brief"), story.id, () => openStory(story));
}

function openSources() {
  const labels = { live: "Live", stale: "Cached", unavailable: "Unavailable" };
  const rows = (payload?.sources ?? []).map(source => '<li class="source-row"><div><a target="_blank" rel="noopener noreferrer" href="' +
    link(source.url) + '">' + escapeText(source.name) + '</a><small>' + escapeText(source.type) +
    '</small></div><span class="source-detail" data-state="' + escapeText(source.state) + '">' +
    escapeText(offline ? "Status offline" : labels[source.state]) + "</span></li>").join("");
  showReader('<h2 id="reader-heading">Feed sources</h2>' +
    (rows ? '<ul class="coverage">' + rows + "</ul>" : "<p>Source status will appear when the feed connects.</p>"), "The wire");
}

function toggleSave(story) {
  const added = !saved.delete(story.id);
  if (added) saved.set(story.id, story);
  const persisted = remember(SAVE_KEY, [...saved.values()]);
  for (const button of document.querySelectorAll("[data-save]")) {
    if (button.dataset.save !== story.id) continue;
    button.setAttribute("aria-pressed", String(added));
    button.setAttribute("aria-label", added ? "Remove from saved" : "Save story");
    if (button.querySelector("span")) button.querySelector("span").textContent = added ? "Saved" : "Save";
  }
  if (view === "saved") {
    const hadFeedFocus = feed.contains(document.activeElement);
    renderFeed();
    if (hadFeedFocus) (feed.querySelector("button") ?? $("#main")).focus();
  }
  announce(persisted ? (added ? "Story saved." : "Story removed from saved.") : "Reading list changed for this session.");
}

function resetSearch() {
  query = "";
  searchInput.value = "";
  searchClear.hidden = true;
  limit = BATCH;
}

function clearSearch() {
  resetSearch();
  renderFeed();
  searchInput.focus();
}

document.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.view) switchView(button.dataset.view);
  if (button.dataset.topic) {
    topic = button.dataset.topic;
    limit = BATCH;
    renderFeed();
    document.querySelector('[data-topic="' + topic + '"]')?.focus({ preventScroll: true });
  }
  if (button.dataset.story) {
    const story = findStory(button.dataset.story);
    if (story) openStory(story);
  }
  if (button.dataset.save) {
    const story = findStory(button.dataset.save);
    if (story) toggleSave(story);
  }
  if (button.matches("#refresh,[data-action=refresh]")) load(true);
  if (button.matches("#view-sources,[data-sources]")) openSources();
  if (button.hasAttribute("data-close")) reader.close();
  if (button === searchClear) clearSearch();
  if (button.id === "mobile-filters") {
    const open = $("#filter-section").classList.toggle("is-open");
    button.setAttribute("aria-expanded", String(open));
  }
  if (button.dataset.action === "more") {
    const firstNewStoryIndex = feed.querySelectorAll(".story-row").length;
    limit += BATCH;
    renderFeed();
    feed.querySelectorAll(".story-row .story-title button")[firstNewStoryIndex]?.focus({ preventScroll: true });
  }
  if (button.dataset.action === "clear") {
    topic = "all";
    resetSearch();
    renderFeed();
    (feed.querySelector("button") ?? $("#main")).focus();
  }
  if (button.dataset.action === "today") {
    switchView("today");
    $("[data-view=today]").focus();
  }
});

reader.addEventListener("click", event => {
  if (event.target === reader && event.clientX < reader.getBoundingClientRect().left) reader.close();
});
reader.addEventListener("close", () => {
  if (returnFocus?.isConnected) returnFocus.focus();
  else (feed.querySelector("button") ?? $("#main")).focus();
});

searchForm.addEventListener("submit", event => {
  event.preventDefault();
  feed.querySelector(".story-title button")?.focus();
});
searchInput.addEventListener("input", () => {
  query = searchInput.value;
  searchClear.hidden = !query;
  limit = BATCH;
  renderFeed();
});
searchInput.addEventListener("keydown", event => {
  if (event.key === "Escape" && searchInput.value) {
    event.preventDefault();
    clearSearch();
  }
});

const briefUI = createBriefUI({ showReader, readerContent, escapeText, link, announce });
$("#model-settings").addEventListener("click", () => briefUI.openSettings());

displayDate();
feedStatus();
renderFeed();
renderSources();
load();
window.setInterval(() => {
  if (document.visibilityState === "visible") load();
}, 5 * 60_000);
