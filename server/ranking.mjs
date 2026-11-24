const RANK_HOUR = 3_600_000;
const RANK_DAY = 24 * RANK_HOUR;
const MONTHS = "january february march april may june july august september october november december".split(" ");
const DATE_WORDS = MONTHS.map(month => month.slice(0, 3) + "(?:" + month.slice(3) + ")?").join("|");
const DATED_ACTION = new RegExp(
  "\\b(?:deadline(?:\\s+is)?|closes?|due|effective(?:\\s+on)?|takes? effect|ends?|retires?|shuts? down|deprecat\\w*|must|no later than)\\b" +
  "(?:(?!\\.\\s)[^!?;]){0,60}?\\b(\\d{4}-\\d{2}-\\d{2}|(?:" + DATE_WORDS + ")\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?)",
  "gi",
);
const SPECULATION = /\b(rumou?r\w*|leak suggests|reportedly considering|could (?:soon )?(?:launch|ship|buy)|may (?:soon )?(?:launch|ship|buy)|expected to launch|predicts?)\b/i;
const COMMENTARY = /^(?:opinion|editorial|roundup|podcast)\s*[:–-]|\b(?:weekly roundup|my predictions|what if we)\b/i;
const INCIDENT = /\b(?:outage|data breach|data exposure|vulnerabilit\w*|ransomware|CVE-\d{4}-\d+|exploit\w*)\b/i;
const ACTIVE_RISK = /\b(?:actively (?:being )?exploited|exploited in the wild|ongoing outage|widespread outage|currently down|active breach)\b/i;
const IMPACTFUL_RISK = /\b(?:critical vulnerability|remote code execution|authentication bypass|data breach|widespread outage|privacy breach|actively exploited)\b/i;
const RESTORED = /\b(?:resolved|restored)\b/i;
const NO_ACTIVE_RISK = /\b(?:no evidence of (?:active )?exploitation|not (?:currently |actively )?exploited)\b/i;
const BREAKING = /\b(?:breaking change|deprecat\w*|end(?:ing|s)? (?:of )?support|shut(?:s|ting)? down|retir(?:e|es|ing|ement)|sunset\w*)\b/i;
const AVAILABILITY = /\b(?:generally available|publicly available|available now|available to all|rolls? out|rolling out|public release)\b/i;
const REQUIREMENT = /\b(?:final rule|compliance|mandatory|takes? effect|effective date|ban(?:s|ned)?|required to)\b/i;
const RELEASE = /\b(?:launch\w*|releas\w*|introduc\w*|debut\w*|unveil\w*|rolls? out|new model|now available)\b/i;
const SELF_TEST = /\b(?:we (?:tested|measured|ran|benchmarked|replicated)|our (?:testing|measurements|benchmark|tests))\b/i;

function signal(points, label) {
  return { points, label };
}

function readDate(raw, articleDate) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const time = Date.parse(raw + "T23:59:59Z");
    return Number.isFinite(time) && new Date(time).toISOString().startsWith(raw) ? time : NaN;
  }
  const match = raw.toLowerCase().match(/^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/);
  if (!match) return NaN;
  const month = MONTHS.findIndex(value => value.startsWith(match[1]));
  if (month < 0) return NaN;
  const day = Number(match[2]);
  const year = match[3] ? Number(match[3]) : new Date(articleDate).getUTCFullYear();
  const time = Date.UTC(year, month, day, 23, 59, 59);
  return new Date(time).getUTCMonth() === month ? time : NaN;
}

function deadlineFor(article, context, now) {
  const published = Date.parse(article.date);
  const dates = [...context.matchAll(DATED_ACTION)].map(([, date]) => readDate(date, published));
  for (const value of article.record?.deadlines ?? []) dates.push(readDate(value, published));
  const next = Math.min(...dates.filter(date => date >= now));
  return Number.isFinite(next) ? Math.ceil((next - now) / RANK_DAY) : Infinity;
}

function evidenceFor(article, source, context, speculative) {
  if (speculative) return signal(1, "Tentative reporting");
  if (source?.role === "advisory") return signal(5, "Official security advisory");
  if (source?.role === "policy") return signal(5, "Official policy document");
  if (source?.role === "release") return signal(4, "Official release notes");
  if (source?.role === "benchmark") return signal(4, "Benchmark publisher");
  if (source?.role === "primary") {
    return RELEASE.test(article.title) ? signal(4, "First-party announcement") : signal(3, "First-party publication");
  }
  if (source?.type === "Preprints") return signal(2, "Preprint");
  if (source?.type === "Reporting" || source?.type === "Independent") {
    if (SELF_TEST.test(context)) return signal(4, "First-hand testing reported");
    if (source?.type === "Reporting") return signal(3, "Published reporting");
    return signal(2, "Independent analysis");
  }
  return signal(2, "Publisher account");
}

function impactFor(article, source, context, facts) {
  const title = article.title;
  if (facts.speculative) return signal(1, "Potential development");
  if (facts.commentary) return signal(1, "Commentary or roundup");
  if (facts.security && (facts.severe || IMPACTFUL_RISK.test(title))) return signal(5, "Serious security or service risk");
  if (facts.security) return signal(3, "Security or service issue");
  if (BREAKING.test(title)) return signal(4, "Breaking change or retirement");
  if (source?.role === "policy" && /\bpublic meetings?\b/i.test(title)) return signal(1, "Administrative notice");
  if (article.topic === "policy" && REQUIREMENT.test(context)) return signal(4, "Change to rules or obligations");
  const describesModel = article.identity?.leadModel || /\b(?:models?|model weights|llms?)\b/i.test(title);
  if (article.topic === "models" && describesModel && (article.identity?.kind === "release" || AVAILABILITY.test(title))) {
    return signal(4, "Model availability or capabilities");
  }
  if (AVAILABILITY.test(title) && article.topic === "products") return signal(4, "Broad product rollout");
  if (article.identity?.kind === "pricing") return signal(3, "Pricing change");
  if (article.topic === "industry") return signal(3, "Industry or infrastructure change");
  if (source?.role === "benchmark") return signal(3, "New benchmarks or methods");
  if (source?.role === "policy") return signal(2, "Policy publication");
  if (article.topic === "research") return signal(2, "Research findings");
  if (source?.role === "release" || article.topic === "tools") return signal(2, "Developer tooling update");
  return signal(2, "Product or industry update");
}

function urgencyFor(article, context, facts, now) {
  if (facts.speculative || facts.commentary) return signal(0, "No immediate action");
  const age = Math.max(0, now - Date.parse(article.date)) / RANK_HOUR;
  const resolved = facts.security && RESTORED.test(context);
  const isActive = facts.security && !resolved && !NO_ACTIVE_RISK.test(context) && ACTIVE_RISK.test(context);
  if (isActive && age <= 48) return signal(5, "Active incident or exploitation");
  const days = deadlineFor(article, context, now);
  if (days <= 3) return signal(5, "Deadline within 3 days");
  if (days <= 14) return signal(4, "Deadline within 2 weeks");
  if (facts.security && facts.severe && !resolved && age <= 72) return signal(4, "Recent high-severity advisory");
  if (days <= 30) return signal(3, "Deadline within 30 days");
  if (isActive && age <= 96) return signal(3, "Recent active incident report");
  if (facts.security && !resolved && age <= 48) return signal(3, "Recent security or service issue");
  if (BREAKING.test(article.title) && age <= 48) return signal(3, "Recent breaking change");
  if (AVAILABILITY.test(article.title) && age <= 72) return signal(2, "Recent rollout");
  if (article.identity?.kind === "release" && age <= 36) return signal(1, "Recent release");
  return signal(0, "No near-term deadline found");
}

function evidenceKey(excerpt) {
  const normalized = excerpt.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
  return normalized.length >= 75 ? normalized.slice(0, 120) : "";
}

export function storyPriority(articles, sources, now) {
  let impact = signal(0, "Limited impact information");
  let urgency = signal(0, "No near-term deadline found");
  let evidence = signal(0, "Limited source information");
  const credited = new Map();
  const excerpts = new Set();
  for (const article of articles) {
    const source = sources.get(article.source);
    const excerpt = article.excerpt ?? "";
    const context = article.title + ". " + excerpt;
    const facts = {
      speculative: SPECULATION.test(article.title),
      commentary: COMMENTARY.test(article.title),
      security: source?.role === "advisory" || INCIDENT.test(article.title),
      severe: ["critical", "high"].includes(article.record?.severity) || /\b(?:critical|high.severity)\b/i.test(article.title),
    };
    const articleImpact = impactFor(article, source, context, facts);
    const articleUrgency = urgencyFor(article, context, facts, now);
    const articleEvidence = evidenceFor(article, source, context, facts.speculative);
    if (articleImpact.points > impact.points) impact = articleImpact;
    if (articleUrgency.points > urgency.points) urgency = articleUrgency;
    if (articleEvidence.points > evidence.points) evidence = articleEvidence;
    const excerptKey = evidenceKey(excerpt);
    const origin = source?.origin ?? article.source;
    if (articleEvidence.points < 3 || facts.commentary || (excerptKey && excerpts.has(excerptKey))) continue;
    if (excerptKey) excerpts.add(excerptKey);
    const kind = source?.type === "Reporting" || source?.type === "Independent" ? "reporting" : source?.role;
    if (!credited.has(origin)) credited.set(origin, kind);
  }

  const types = new Set(credited.values());
  if (credited.size >= 2 && types.has("reporting") &&
      (types.has("primary") || types.has("advisory") || types.has("policy") || types.has("release") || types.has("benchmark"))) {
    evidence = signal(Math.min(5, evidence.points + 1), "Primary source and reporting");
  }

  return { impact, urgency, evidence, score: 8 * impact.points + 6 * urgency.points + 6 * evidence.points };
}
