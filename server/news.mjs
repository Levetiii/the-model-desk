import { storyPriority } from "./ranking.mjs";

export const FEEDS = [
  { id: "ars", name: "Ars Technica", type: "Reporting", weight: 14, url: "https://arstechnica.com/ai/feed/" },
  { id: "techreview", name: "MIT Technology Review", type: "Reporting", weight: 12, url: "https://www.technologyreview.com/topic/artificial-intelligence/feed/" },
  { id: "verge", name: "The Verge", type: "Reporting", weight: 11, url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml" },
  { id: "openai", name: "OpenAI", type: "Lab", role: "primary", weight: 10, url: "https://openai.com/news/rss.xml" },
  { id: "deepmind", name: "Google DeepMind", type: "Lab", role: "primary", origin: "google", weight: 10, url: "https://deepmind.google/blog/rss.xml" },
  { id: "githubsecurity", name: "GitHub Advisory Database", type: "Security advisories", role: "advisory", format: "advisories", topic: "policy", weight: 13, limit: 8,
    url: "https://api.github.com/advisories?affects=vllm%2Ctorch%2Ctransformers%2Cllama-cpp-python%2Clangchain-core%2Copen-webui&per_page=25",
    home: "https://github.com/advisories" },
  { id: "cisa", name: "CISA Cybersecurity Alerts", type: "Security alerts", role: "advisory", topic: "policy", aiOnly: true, weight: 13, limit: 6,
    url: "https://www.cisa.gov/cybersecurity-advisories/alerts.xml", home: "https://www.cisa.gov/news-events/cybersecurity-advisories" },
  { id: "federalregister", name: "U.S. Federal Register", type: "Policy", role: "policy", format: "register", topic: "policy", weight: 13, limit: 7,
    url: "https://www.federalregister.gov/api/v1/documents.json?conditions%5Bterm%5D=%22artificial+intelligence%22&order=newest&per_page=20",
    home: "https://www.federalregister.gov/documents/search?conditions%5Bterm%5D=artificial+intelligence" },
  { id: "qwen", name: "Qwen", type: "Lab", role: "primary", weight: 9, limit: 8, url: "https://qwenlm.github.io/blog/index.xml" },
  { id: "arxiv", name: "arXiv cs.AI", type: "Preprints", topic: "research", limit: 5, url: "https://rss.arxiv.org/rss/cs.AI" },
  { id: "mlcommons", name: "MLCommons", type: "Benchmarks", role: "benchmark", topic: "research", weight: 8, limit: 7, url: "https://mlcommons.org/feed/" },
  { id: "huggingface", name: "Hugging Face", type: "Open source", weight: 5, url: "https://huggingface.co/blog/feed.xml" },
  { id: "simon", name: "Simon Willison", type: "Independent", weight: 4, url: "https://simonwillison.net/tags/llms.atom" },
  { id: "interconnects", name: "Interconnects", type: "Independent", weight: 4, limit: 8, url: "https://www.interconnects.ai/feed" },
  { id: "appleml", name: "Apple Machine Learning Research", type: "Research lab", role: "primary", topic: "research", weight: 7, limit: 7, url: "https://machinelearning.apple.com/rss.xml" },
  { id: "googleresearch", name: "Google Research", type: "Research lab", role: "primary", origin: "google", topic: "research", aiOnly: true, weight: 7, limit: 7, url: "https://research.google/blog/rss/" },
  { id: "mitnews", name: "MIT News AI", type: "University", role: "primary", topic: "research", weight: 7, limit: 8, url: "https://news.mit.edu/rss/topic/artificial-intelligence2" },
  { id: "vllm", name: "vLLM", type: "Open-source releases", role: "release", project: "vLLM", topic: "tools", weight: 7, limit: 5, url: "https://github.com/vllm-project/vllm/releases.atom" },
  { id: "llamacpp", name: "llama.cpp", type: "Open-source releases", role: "release", project: "llama.cpp", topic: "tools", weight: 6, limit: 5, url: "https://github.com/ggml-org/llama.cpp/releases.atom" },
  { id: "pytorch", name: "PyTorch", type: "Open-source releases", role: "release", project: "PyTorch", topic: "tools", weight: 7, limit: 5, url: "https://github.com/pytorch/pytorch/releases.atom" },
];
const FEED_BY_ID = new Map(FEEDS.map(source => [source.id, source]));

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MAX_BYTES = 1_500_000;
const SOURCE_CONCURRENCY = 5;
const SOURCE_TIMEOUT = 4_500;
const REFRESH_TIMEOUT = 11_500;
export const CACHE_AGE = 10 * MINUTE;
export const FEED_EVIDENCE_VERSION = 1;
const AI_RELEVANCE = /\b(?:artificial intelligence|machine learning|large language models?|generative ai|neural networks?|transformer models?|foundation models?|llms?|ai|vllm|pytorch|langchain|llama\.cpp|open webui)\b/i;

export const TOPICS = {
  models: "Models & releases",
  research: "Research",
  tools: "Tools & open source",
  products: "Products",
  industry: "Business & infrastructure",
  policy: "Policy & safety",
};

const ENTITY = { amp: "&", apos: "'", quot: '"', lt: "<", gt: ">", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…" };

export function decode(value) {
  return value.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]+);/gi, (match, key) => {
    if (key[0] !== "#") return Object.hasOwn(ENTITY, key) ? ENTITY[key] : match;
    const point = key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : " ";
  });
}

export function plain(value = "") {
  return decode(decode(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"))
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(?:[a-z!/?])[^>]*>/gi, " "))
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim();
}

function field(xml, name) {
  const pattern = new RegExp("<" + name + "(?:\\s[^>]*?)?>([\\s\\S]*?)<\\/" + name + "\\s*>", "i");
  return xml.match(pattern)?.[1] ?? "";
}

function articleUrl(raw) {
  try {
    const url = new URL(decode(raw.trim()));
    if (url.protocol !== "https:" || url.username || url.password) return "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.*|ref|ref_src|fbclid|gclid|mc_cid|mc_eid|guccounter)$/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/$/, "");
    url.searchParams.sort();
    return url.href;
  } catch {
    return "";
  }
}

function evidenceLinks(markup, base) {
  const links = new Set();
  for (const [, , target] of decode(markup).matchAll(/<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1/gi)) {
    try {
      const url = articleUrl(new URL(target, base).href);
      if (url && url !== base && !/\.(?:png|jpe?g|zip|mp4)$/i.test(url)) links.add(url);
    } catch {
      // A malformed reference has no supporting document.
    }
    if (links.size >= 12) break;
  }
  return [...links];
}

function atomLink(xml) {
  for (const [tag] of xml.matchAll(/<link\b[^>]*\/?\s*>/gi)) {
    const attrs = Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)].map(([, key, , value]) => [key.toLowerCase(), value]));
    if (attrs.href && (!attrs.rel || attrs.rel === "alternate")) return attrs.href;
  }
  return "";
}

function shorten(value, max) {
  if (value.length <= max) return value;
  const boundary = value.lastIndexOf(" ", max - 1);
  return value.slice(0, boundary > max * 0.7 ? boundary : max - 1).trimEnd() + "…";
}

function modelMentions(text) {
  const variants = "opus|sonnet|haiku|flash(?:-lite)?|pro|fable|mythos|large|small|max|coder|mini|nano|sol|astra|hydrogen|carbon|argon|ultra|turbo|preview";
  const pattern = new RegExp("\\b(gpt|claude|gemini|grok|llama|qwen|deepseek|mistral|kimi)\\s*[- ]?\\s*(?:(" + variants +
    ")\\s+)?(\\d+(?:\\.\\d+)*)\\b(?:[- ](" + variants + ")\\b)?", "g");
  return [...text.matchAll(pattern)].map(([, family, before, version, after]) => ({ family, version, variant: before ?? after }));
}

function identity(title, excerpt) {
  const normalized = title.toLowerCase().replace(/chatgpt/g, "openai").replace(/deep mind/g, "deepmind");
  const reportedModels = modelMentions(normalized);
  const available = [...reportedModels];
  const described = modelMentions(excerpt.toLowerCase());
  for (const model of described) {
    if (!normalized.includes(model.family) || available.some(other => other.family === model.family)) continue;
    available.push(model);
  }
  const versions = new Map();
  for (const model of available) {
    if (!versions.has(model.family)) versions.set(model.family, []);
    versions.get(model.family).push(model);
  }
  const kinds = [
    ["incident", /\b(outage|breach|vulnerability|cve-\d|leak(?:ed|s)?|exploit(?:ed)?)\b/],
    ["pricing", /\b(price cut|pricing|raises prices|cuts prices|more expensive|subscription price)\b/],
    ["policy", /\b(lawsuit|sues|sued|regulation|antitrust|court|bans|settlement)\b/],
    ["business", /\b(acquires|acquisition|funding|ipo|raises \$|invests|stake)\b/],
    ["release", /\b(launch(?:es|ed)?|release(?:s|d)?|introduc(?:es|ing)|unveil(?:s|ed)?|debut(?:s|ed)?|rolls? out)\b/],
  ];
  const kind = kinds.find(([, pattern]) => pattern.test(normalized))?.[0] ??
    (available.length && /\bnew\s+(?:\w+\s+){0,2}(?:gpt|claude|gemini|grok|llama|qwen|deepseek|mistral|kimi|model)\b/.test(normalized)
      ? "release" : undefined);
  return { versions, kind, leadModel: available[0] };
}

function topicFor(title, source) {
  const t = title.toLowerCase();
  if (source.topic) return source.topic;
  if (/\b(outage|breach|malware|vulnerabilit|regulat|lawsuit|sued|antitrust|copyright|security|safety|surveillance|bans?)\w*/.test(t)) return "policy";
  if (/\b(funding|acquisition|acquires|invests|investors|layoffs|chip|gpu|datacenter|data centers?|ipo|billion|stakes?|bought|merger|supply|capacity)\b/.test(t)) return "industry";
  if (/\b(research|paper|benchmark|dataset|scientists|study|evaluation|inference test|preprint)\b/.test(t)) return "research";
  if (/\b(open.source|hugging face|repository|sdk|framework|vllm|ollama|llama.cpp|cli|weights|toolkit|quantization|coding agent|datasette|plugin)\b/.test(t) || source.id === "huggingface") return "tools";
  if (/\b(model|gpt|claude|gemini|llama|qwen|grok|deepseek|mistral)\b/.test(t) && /\b(model|launch|release|version|introducing|introduces|preview|\d+)\b/.test(t)) return "models";
  return "products";
}

function publishedDate(value, now) {
  const published = Date.parse(value);
  if (!Number.isFinite(published) || published > now + DAY || published < now - 14 * DAY) return null;
  return new Date(published).toISOString();
}

function orderedArticles(articles, source) {
  return articles.sort((a, b) => b.date.localeCompare(a.date)).slice(0, source.limit ?? 15);
}

export function parseFeed(xml, source, now = Date.now()) {
  if (!/<(?:rss|feed|rdf:RDF)(?:\s|>)/i.test(xml)) throw new Error("Invalid feed");
  const articles = [];
  for (const [, body] of xml.matchAll(/<(?:item|entry)(?:\s[^>]*?)?>([\s\S]*?)<\/(?:item|entry)\s*>/gi)) {
    let title = plain(field(body, "title"));
    const url = articleUrl(field(body, "link") || atomLink(body));
    const date = publishedDate(plain(field(body, "pubDate") || field(body, "published") || field(body, "dc:date") || field(body, "updated")), now);
    if (!title || !url || !date) continue;
    if (source.project && !title.toLowerCase().includes(source.project.toLowerCase())) title = source.project + " " + title;
    const markup = field(body, "description") || field(body, "summary") || (source.project ? field(body, "content") : "");
    const excerpt = plain(markup)
      .replace(/^arXiv:[\d.]+(?:v\d+)?\s+(?:Announce Type|Abstract):\s*/i, "")
      .replace(/^.*?\bAbstract:\s*/i, source.id === "arxiv" ? "" : "$&");
    if (source.aiOnly && !AI_RELEVANCE.test(title + " " + excerpt.slice(0, 500))) continue;
    const article = feedArticle(source, title, excerpt, url, date);
    const references = evidenceLinks(markup, url);
    if (references.length) article.references = references;
    articles.push(article);
  }
  return orderedArticles(articles, source);
}

function feedArticle(source, title, excerpt, url, date, record) {
  return {
    title: shorten(title, 260), url, date, excerpt: shorten(excerpt, 350), evidence: shorten(excerpt, 1900),
    source: source.id, topic: topicFor(title, source), ...(record ? { record } : {}),
  };
}

function advisoryArticles(data, source, now) {
  if (!Array.isArray(data)) throw new Error("Invalid advisory response");
  return data.flatMap(entry => {
    const date = publishedDate(entry?.published_at, now);
    const url = articleUrl(entry?.html_url);
    if (!date || !url || new URL(url).hostname !== "github.com" || typeof entry?.summary !== "string" || entry.withdrawn_at) return [];
    const key = [entry.cve_id, entry.ghsa_id].filter(id => typeof id === "string" && /^(CVE|GHSA)-[\w-]+$/i.test(id));
    const severity = ["critical", "high", "medium", "low"].includes(entry.severity) ? entry.severity : "";
    const prefix = [key[0], severity && "Severity: " + severity].filter(Boolean).join(" · ");
    const description = [prefix, typeof entry.description === "string" ? plain(entry.description) : ""].filter(Boolean).join(". ");
    const title = key[0] && !entry.summary.includes(key[0]) ? entry.summary + " (" + key[0] + ")" : entry.summary;
    return [feedArticle(source, plain(title), description, url, date, { severity, advisoryIds: key })];
  });
}

function registerArticles(data, source, now) {
  if (!Array.isArray(data?.results)) throw new Error("Invalid policy response");
  return data.results.flatMap(entry => {
    const date = publishedDate(entry?.publication_date, now);
    const url = articleUrl(entry?.html_url);
    if (!date || !url || new URL(url).hostname !== "www.federalregister.gov" || typeof entry?.title !== "string") return [];
    const title = plain(entry.title);
    const abstract = typeof entry.abstract === "string" ? plain(entry.abstract) : "";
    if (!AI_RELEVANCE.test(title + " " + abstract.slice(0, 480))) return [];
    const kind = ["Notice", "Rule", "Proposed Rule", "Presidential Document"].includes(entry.type) ? entry.type : "";
    const excerpt = [kind, abstract].filter(Boolean).join(". ");
    const agency = Array.isArray(entry.agencies) ? entry.agencies.find(agency => typeof agency?.name === "string")?.name : "";
    const headline = title.length < 45 && agency ? title + " — " + agency : title;
    const deadlines = [entry.comments_close_on, entry.effective_on].filter(value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value));
    return [feedArticle(source, headline, excerpt, url, date, { deadlines, documentType: kind })];
  });
}

export function parseSource(text, source, now = Date.now()) {
  if (source.format === "advisories") return orderedArticles(advisoryArticles(JSON.parse(text), source, now), source);
  if (source.format === "register") return orderedArticles(registerArticles(JSON.parse(text), source, now), source);
  return parseFeed(text, source, now);
}

const STOP = new Set("a an and as at be been but by can could for from had has have he her how i in into is it its just more new now of on one or our out over says she than that the their them they this to up was we were what when where who why will with would you your ai here after about launches launch release releases introduces introducing unveils".split(" "));

function words(title) {
  return new Set(title.toLowerCase().replace(/['’]/g, "").match(/[\p{L}\p{N}]+(?:\.\d+)?/gu)?.filter(word => word.length > 1 && !STOP.has(word)) ?? []);
}

function compatibleVersion(a, b) {
  for (const [family, versions] of a) {
    if (b.has(family) && !versions.some(left => b.get(family).some(right =>
      left.version === right.version && (!left.variant || !right.variant || left.variant === right.variant)))) return false;
  }
  return true;
}

function sameNamedRelease(left, right) {
  return left.kind === "release" && right.kind === "release" &&
    left.leadModel?.variant && left.leadModel.family === right.leadModel?.family &&
    left.leadModel.version === right.leadModel.version && left.leadModel.variant === right.leadModel.variant;
}

function arxivId(url) {
  return new URL(url).hostname === "arxiv.org" ? url.match(/\/(?:abs|pdf)\/([^?#]+?)(?:v\d+)?(?:\.pdf)?$/)?.[1] : undefined;
}

function similarity(a, b) {
  const leftAdvisory = a.record?.advisoryIds ?? a.title.match(/(?:CVE-\d{4}-\d{4,}|GHSA-[\w-]+)/gi) ?? [];
  const rightAdvisory = b.record?.advisoryIds ?? b.title.match(/(?:CVE-\d{4}-\d{4,}|GHSA-[\w-]+)/gi) ?? [];
  if (leftAdvisory.length && rightAdvisory.length) {
    return leftAdvisory.some(id => rightAdvisory.some(other => id.toLowerCase() === other.toLowerCase())) ? 1 : 0;
  }
  const leftPaper = arxivId(a.url);
  const rightPaper = arxivId(b.url);
  if (leftPaper && rightPaper) return leftPaper === rightPaper ? 1 : 0;
  if (Math.abs(Date.parse(a.date) - Date.parse(b.date)) > 72 * HOUR) return 0;
  if (a.identity.kind && b.identity.kind && a.identity.kind !== b.identity.kind) return 0;
  if (!compatibleVersion(a.identity.versions, b.identity.versions)) return 0;
  if (sameNamedRelease(a.identity, b.identity)) return 0.95;
  const overlap = [...a.words].filter(word => b.words.has(word));
  const smaller = Math.min(a.words.size, b.words.size);
  if (overlap.length === smaller && smaller >= 3 && a.words.size === b.words.size) return 1;
  if (overlap.length < 3) return 0;
  const jaccard = overlap.length / (a.words.size + b.words.size - overlap.length);
  const containment = overlap.length / smaller;
  const sameVersion = [...a.identity.versions].some(([family, versions]) =>
    versions.some(left => b.identity.versions.get(family)?.some(right => left.version === right.version)));
  if (overlap.length >= 5 && (jaccard >= 0.58 || (containment >= 0.86 && jaccard >= 0.42))) return Math.max(jaccard, 0.7);
  if (sameVersion && a.identity.kind && a.identity.kind === b.identity.kind && jaccard >= 0.33 && containment >= 0.6) return jaccard;
  return 0;
}

function stableId(url) {
  let hash = 2166136261;
  for (const char of url) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
  return "story-" + (hash >>> 0).toString(36);
}

function sourceWeight(id) {
  return FEED_BY_ID.get(id)?.weight ?? 0;
}

export function clusterArticles(items, previousStories = [], now = Date.now(), sources = FEED_BY_ID) {
  const byUrl = new Map();
  for (const item of items) {
    const duplicate = byUrl.get(item.url);
    if (!duplicate || sourceWeight(item.source) > sourceWeight(duplicate.source)) byUrl.set(item.url, item);
  }
  const priorIds = new Map(previousStories.flatMap(story => story.articles.map(article => [article.url, story.id])));
  const candidates = [...byUrl.values()].sort((a, b) => a.date.localeCompare(b.date) || a.url.localeCompare(b.url))
    .map(article => ({ ...article, words: words(article.title), identity: identity(article.title, article.excerpt) }));
  const groups = [];
  for (const item of candidates) {
    let match;
    let best = 0;
    for (const group of groups) {
      const score = similarity(group[0], item);
      if (score > best && group.every(other => compatibleVersion(other.identity.versions, item.identity.versions) &&
        (!other.identity.kind || !item.identity.kind || other.identity.kind === item.identity.kind))) {
        match = group;
        best = score;
      }
    }
    if (match) match.push(item);
    else groups.push([item]);
  }
  const usedIds = new Set();
  return groups.map(group => {
    const prior = group.map(item => priorIds.get(item.url)).find(id => id && !usedIds.has(id));
    const id = prior ?? stableId(group[0].url);
    usedIds.add(id);
    const articles = group.map(({ words: ignoredWords, identity: ignoredIdentity, ...article }) => article)
      .sort((a, b) => sourceWeight(b.source) - sourceWeight(a.source) ||
        Number(Boolean(b.excerpt)) - Number(Boolean(a.excerpt)) ||
        b.date.localeCompare(a.date));
    const lead = articles[0];
    const date = group.at(-1).date;
    const sourceCount = new Set(articles.map(article => article.source)).size;
    const priority = storyPriority(group, sources, now);
    return { id, title: lead.title, topic: lead.topic, excerpt: lead.excerpt, date, rank: priority.score, priority, sourceCount, articles };
  }).sort((a, b) => b.rank - a.rank || b.priority.urgency.points - a.priority.urgency.points || b.date.localeCompare(a.date));
}

export async function boundedText(response, maximum = MAX_BYTES) {
  const length = Number(response.headers.get("content-length"));
  if (length > maximum || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Invalid response size");
  }
  const reader = response.body.getReader();
  const decode = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maximum) throw new Error("Invalid response size");
      text += decode.decode(chunk.value, { stream: true });
    }
    return text + decode.decode();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function nearbyIndependentCoverage(story, snapshot) {
  const annotate = article => ({ ...article, words: words(article.title), identity: identity(article.title, article.excerpt) });
  const seed = story.articles.map(annotate);
  const included = new Set(story.articles.map(article => article.url));
  const related = [];
  for (const next of snapshot.stories) {
    if (next.id === story.id || Math.abs(Date.parse(next.date) - Date.parse(story.date)) > 10 * DAY) continue;
    for (const article of next.articles) {
      const source = FEED_BY_ID.get(article.source);
      if (included.has(article.url) ||
          !(["Reporting", "Independent"].includes(source?.type) || source?.role === "benchmark")) continue;
      const candidate = annotate(article);
      let confidence = 0;
      for (const initial of seed) {
        if (article.references?.includes(initial.url)) confidence = Math.max(confidence, 1);
        confidence = Math.max(confidence, similarity(initial, candidate));
        if (!initial.identity.leadModel || !candidate.identity.leadModel) continue;
        const a = initial.identity.leadModel;
        const b = candidate.identity.leadModel;
        if (a.family === b.family && a.version === b.version && a.variant && a.variant === b.variant &&
            /\b(?:test\w*|benchmark\w*|evaluat\w*|retest\w*|measur\w*|review\w*)\b/i.test(article.title)) {
          confidence = Math.max(confidence, 0.75);
        }
      }
      if (confidence >= 0.68) related.push({ article, confidence });
    }
  }
  const seen = new Set();
  return related.sort((a, b) => b.confidence - a.confidence || b.article.date.localeCompare(a.article.date))
    .flatMap(({ article }) => {
      const origin = FEED_BY_ID.get(article.source)?.origin ?? article.source;
      if (seen.has(origin)) return [];
      seen.add(origin);
      return [article];
    }).slice(0, 3);
}

async function pull(source, prior, fetchImpl, now, refreshDeadline) {
  try {
    const headers = {
      accept: source.format ? "application/json" : "application/rss+xml, application/atom+xml, application/xml, text/xml",
      "user-agent": "TheModelDesk/1.0",
    };
    if (source.format === "advisories") headers["x-github-api-version"] = "2022-11-28";
    if (prior?.etag) headers["if-none-match"] = prior.etag;
    if (prior?.lastModified) headers["if-modified-since"] = prior.lastModified;
    const signal = AbortSignal.any([AbortSignal.timeout(SOURCE_TIMEOUT), refreshDeadline]);
    let url = source.url;
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetchImpl(url, { headers, signal, redirect: "manual" });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const target = new URL(response.headers.get("location"), url);
      const allowed = [new URL(source.url).hostname, ...(source.redirectHosts ?? [])];
      if (target.protocol !== "https:" || target.username || target.password || target.port || !allowed.includes(target.hostname)) {
        throw new Error("Invalid feed redirect");
      }
      await response.body?.cancel();
      url = target.href;
    }
    if (response.status === 304 && prior) return { ...prior, state: "live", checkedAt: new Date(now).toISOString() };
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Feed status " + response.status);
    }
    return {
      state: "live", checkedAt: new Date(now).toISOString(),
      etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified"),
      articles: parseSource(await boundedText(response), source, now),
    };
  } catch {
    return { ...prior, state: prior?.checkedAt ? "stale" : "unavailable", articles: prior?.articles ?? [] };
  }
}

export async function collectNews(previous, { now = Date.now(), sources = FEEDS, fetchImpl = fetch } = {}) {
  const deadline = AbortSignal.timeout(REFRESH_TIMEOUT);
  const results = new Array(sources.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(sources.length, SOURCE_CONCURRENCY) }, async () => {
    while (cursor < sources.length) {
      const index = cursor++;
      const source = sources[index];
      const saved = previous?.feeds?.[source.id];
      const prior = saved && previous.evidenceVersion !== FEED_EVIDENCE_VERSION ?
        { ...saved, etag: null, lastModified: null } : saved;
      const result = await pull(source, prior, fetchImpl, now, deadline);
      result.articles = result.articles.filter(article => Date.parse(article.date) >= now - 14 * DAY);
      results[index] = [source.id, result];
    }
  }));
  const feeds = Object.fromEntries(results);
  const stories = clusterArticles(results.flatMap(([, feed]) => feed.articles), previous?.stories, now, new Map(sources.map(source => [source.id, source])));
  const live = results.some(([, feed]) => feed.state === "live");
  return { evidenceVersion: FEED_EVIDENCE_VERSION, checkedAt: new Date(now).toISOString(),
    updatedAt: live ? new Date(now).toISOString() : previous?.updatedAt ?? null, feeds, stories };
}

export function publicNews(snapshot, sources = FEEDS) {
  return {
    updatedAt: snapshot.updatedAt,
    topics: TOPICS,
    stories: snapshot.stories.map(story => ({
      ...story,
      articles: story.articles.map(({ evidence, record, references, ...article }) => article),
    })),
    sources: sources.map(({ id, name, type, url, home }) => ({
      id, name, type, url: home ?? url, state: snapshot.feeds[id]?.state ?? "unavailable",
      checkedAt: snapshot.feeds[id]?.checkedAt ?? null,
    })),
  };
}

export function newsResponse(snapshot) {
  return Response.json(publicNews(snapshot), { headers: {
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  } });
}
