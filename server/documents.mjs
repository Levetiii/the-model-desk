import { boundedText, decode, plain } from "./news.mjs";

const DOCUMENT_AGENT = "TheModelDesk";
const DOCUMENT_LIMIT = 1_200_000;
const MAX_ORIGINALS = 4;
const ORIGINAL_EXCERPT_LIMIT = 4200;
const DOCUMENT_RULES = {
  "openai.com": { path: /^\/(?:index|research)\/[^/]+\/?$/, publisher: "OpenAI", origin: "openai", type: "Lab" },
  "deepmind.google": { path: /^\/blog\/[^/]+\/?$/, publisher: "Google DeepMind", origin: "google", type: "Lab" },
  "blog.google": { path: /^\/innovation-and-ai\/(?:models-and-research|products)\/.+\/?$/, publisher: "Google", origin: "google", type: "Lab" },
  "research.google": { path: /^\/blog\/[^/]+\/?$/, publisher: "Google Research", origin: "google", type: "Research lab" },
  "machinelearning.apple.com": { path: /^\/research\/[^/]+\/?$/, publisher: "Apple Machine Learning Research", origin: "appleml", type: "Research lab" },
  "qwenlm.github.io": { path: /^\/blog\/[^/]+\/?$/, publisher: "Qwen", origin: "qwen", type: "Lab" },
  "news.mit.edu": { path: /^\/\d{4}\/[^/]+\/?$/, publisher: "MIT News", origin: "mit", type: "University" },
  "arxiv.org": {
    path: /^\/abs\/(?:\d{4}\.\d{4,5}|[a-z.-]+\/\d{7})(?:v\d+)?$/i,
    publisher: "arXiv", origin: "arxiv", type: "Preprints", layout: "abstract",
  },
  "github.com": {
    path: /^\/(?:(?:vllm-project\/vllm|ggml-org\/llama\.cpp|pytorch\/pytorch)\/(?:releases\/tag\/[^/]+|security\/advisories\/GHSA-[\w-]+)|advisories\/GHSA-[\w-]+)\/?$/i,
    publisher: "GitHub", origin: "github", type: "Open source", layout: "github",
  },
  "www.cisa.gov": {
    path: /^\/news-events\/cybersecurity-advisories\/(?:alerts|cybersecurity-advisories)\/[^/]+\/?$/,
    publisher: "CISA", origin: "cisa", type: "Security alerts", role: "advisory",
  },
  "www.govinfo.gov": {
    path: /^\/content\/pkg\/FR-\d{4}-\d{2}-\d{2}\/html\/[\w-]+\.htm$/i,
    publisher: "U.S. Federal Register (GovInfo)", origin: "federalregister", type: "Policy", role: "policy", layout: "federal",
  },
  "mlcommons.org": {
    path: /^\/(?:\d{4}\/\d{2}\/[^/]+|benchmarks\/[^/]+)\/?$/,
    publisher: "MLCommons", origin: "mlcommons", type: "Benchmarks", role: "benchmark",
  },
};

export function originalDocumentUrl(raw) {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.port || url.username || url.password) return null;
    if (url.hostname === "www.federalregister.gov") {
      const match = url.pathname.match(/^\/documents\/(\d{4})\/(\d{2})\/(\d{2})\/([\w-]+)\//);
      if (match) {
        const [, year, month, day, id] = match;
        return new URL("https://www.govinfo.gov/content/pkg/FR-" + year + "-" + month + "-" + day + "/html/" + id + ".htm");
      }
    }
    const rule = DOCUMENT_RULES[url.hostname];
    if (!rule || !rule.path.test(url.pathname) || /%(?:2f|5c)|[\\%]/i.test(url.pathname)) return null;
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

export function allowedByRobots(text, path) {
  const groups = [];
  let group;
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split("#", 1)[0].match(/^\s*(user-agent|allow|disallow)\s*:\s*(.*?)\s*$/i);
    if (!parts) continue;
    const [, field, value] = parts;
    if (field.toLowerCase() === "user-agent") {
      if (!group || group.hasDirective) {
        group = { agents: [], rules: [], hasDirective: false };
        groups.push(group);
      }
      group.agents.push(value.toLowerCase());
    } else if (group) {
      group.hasDirective = true;
      if (value.startsWith("/")) group.rules.push({ allow: field.toLowerCase() === "allow", value });
    }
  }
  const exact = groups.filter(group => group.agents.includes(DOCUMENT_AGENT.toLowerCase()));
  const selected = exact.length ? exact : groups.filter(group => group.agents.includes("*"));
  let match = { length: -1, allow: true };
  for (const { value, allow } of selected.flatMap(group => group.rules)) {
    const end = value.endsWith("$");
    const base = end ? value.slice(0, -1) : value;
    const pattern = base.replace(/\*+/g, "*").split("*").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    const length = base.replace(/\*/g, "").length;
    if (new RegExp("^" + pattern + (end ? "$" : "")).test(path) &&
        (length > match.length || (length === match.length && allow))) match = { length, allow };
  }
  return match.allow;
}

function compactDocumentText(value) {
  return plain(value).replace(/\s+/g, " ").trim();
}

function articleSection(html, layout) {
  if (layout === "abstract") {
    return html.match(/<blockquote\b[^>]*\babstract\b[^>]*>([\s\S]*?)<\/blockquote>/i)?.[1] ?? "";
  }
  if (layout === "federal") {
    return html.match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/i)?.[1] ?? "";
  }
  if (layout === "github") {
    const markdown = html.search(/class\s*=\s*["'][^"']*\bmarkdown-body\b/i);
    if (markdown >= 0) {
      const start = html.indexOf(">", markdown);
      return html.slice(start + 1, start + 80_000).split(/<\/section>|<footer\b/i, 1)[0];
    }
  }
  return html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
    html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? "";
}

export function parseOriginalDocument(html, rule) {
  const safe = html.replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|nav|footer|aside|template)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const section = articleSection(safe, rule.layout);
  if (!section) return null;
  const title = compactDocumentText(safe.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ??
    safe.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").slice(0, 240);
  const textBlocks = ["abstract", "federal"].includes(rule.layout) ?
    section.split(/\r?\n[\t ]*\r?\n/).map(compactDocumentText).filter(Boolean) :
    [...section.matchAll(/<(p|li|blockquote|dd)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
      .map(([, , content]) => compactDocumentText(content)).filter(value => value.length >= 30);
  const stable = [...new Set(textBlocks)].join("\n\n");
  if (stable.length < 85 || /\b(?:verify you are human|enable javascript and cookies to continue|captcha challenge)\b/i.test(stable.slice(0, 400))) return null;
  const end = stable.lastIndexOf(" ", ORIGINAL_EXCERPT_LIMIT);
  return { title, excerpt: stable.length <= ORIGINAL_EXCERPT_LIMIT ? stable : stable.slice(0, end) };
}

async function rulesFor(url, fetchDocument, signal) {
  const response = await fetchDocument(new URL("/robots.txt", url).href, {
    redirect: "error", signal, headers: { "User-Agent": DOCUMENT_AGENT + "/1.0", Accept: "text/plain" },
  });
  if (response.status === 404 || response.status === 410) {
    await response.body?.cancel();
    return "";
  }
  if (!response.ok || !/^text\/plain\b/i.test(response.headers.get("content-type") ?? "")) {
    await response.body?.cancel();
    throw new Error("Robots policy unavailable");
  }
  return boundedText(response, 512_000);
}

async function downloadOriginal(initial, fetchDocument, rules, signal) {
  let url = initial;
  for (let hop = 0; hop < 3; hop++) {
    if (!rules.has(url.origin)) rules.set(url.origin, rulesFor(url, fetchDocument, signal));
    if (!allowedByRobots(await rules.get(url.origin), url.pathname)) return null;
    const response = await fetchDocument(url.href, {
      redirect: "manual", signal, headers: { "User-Agent": DOCUMENT_AGENT + "/1.0", Accept: "text/html, application/xhtml+xml" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const target = response.headers.get("location");
      url = target ? originalDocumentUrl(new URL(target, url).href) : null;
      if (!url) return null;
      continue;
    }
    if (!response.ok || !/^(?:text\/html|application\/xhtml\+xml)\b/i.test(response.headers.get("content-type") ?? "")) {
      await response.body?.cancel();
      return null;
    }
    const rule = DOCUMENT_RULES[url.hostname];
    const original = parseOriginalDocument(await boundedText(response, DOCUMENT_LIMIT), rule);
    return original ? { ...original, rule, url: url.href } : null;
  }
  return null;
}

export async function enrichOriginalDocuments(documents, articles, fetchDocument = fetch) {
  const targets = new Map();
  for (const document of documents) {
    const url = originalDocumentUrl(document.url);
    if (url && !targets.has(url.href)) targets.set(url.href, { url, document });
  }
  for (const reference of articles.flatMap(article => article.references ?? [])) {
    const url = originalDocumentUrl(reference);
    if (url && !targets.has(url.href)) targets.set(url.href, { url });
  }
  const rules = new Map();
  const signal = AbortSignal.timeout(6000);
  const originals = await Promise.all([...targets.values()].slice(0, MAX_ORIGINALS).map(async ({ url, document }) => {
    try {
      const result = await downloadOriginal(url, fetchDocument, rules, signal);
      if (!result) return null;
      const { rule } = result;
      const known = document ?? documents.find(item => originalDocumentUrl(item.url)?.href === result.url);
      const role = rule.layout === "github" ?
        (/\/(?:security\/)?advisories\//.test(result.url) ? "advisory" : "release") : rule.role;
      return {
        priorId: known?.id,
        doc: {
          publisher: known?.publisher ?? rule.publisher, origin: known?.origin ?? rule.origin,
          sourceType: known?.sourceType ?? rule.type, sourceRole: known?.sourceRole ?? role ?? null,
          independent: known?.independent ?? rule.role === "benchmark",
          title: known?.title ?? (result.title || rule.publisher), excerpt: result.excerpt,
          date: known?.date ?? null, url: result.url,
          scope: rule.layout === "abstract" ? "Original abstract" : "Original document",
        },
      };
    } catch {
      return null;
    }
  }));
  const replacements = new Map(originals.filter(item => item?.priorId).map(item => [item.priorId, item.doc]));
  const knownUrls = new Set(documents.map(doc => doc.url));
  const supplemental = originals.filter(item => item && !item.priorId && !knownUrls.has(item.doc.url))
    .map(item => item.doc);
  const final = [...documents.map(document => replacements.get(document.id) ?? document), ...supplemental];
  return final.filter((document, index) => final.findIndex(other => other.url === document.url) === index)
    .slice(0, 8).map((doc, index) => ({ ...doc, id: "S" + (index + 1) }));
}
