import test from "node:test";
import assert from "node:assert/strict";
import { clusterArticles, collectNews, FEEDS, parseFeed, parseSource, publicNews } from "../server/news.mjs";

const now = Date.parse("2026-11-15T08:00:00Z");
const time = new Date(now).toISOString();
const source = { id: "ars", name: "Ars Technica", url: "https://publisher.example/feed" };

function article(title, slug, publisher = "ars") {
  return { title, url: "https://publisher.example/" + slug, source: publisher, date: time, excerpt: "", topic: "models" };
}

test("reads RSS and Atom, cleans publisher text, and removes tracking parameters", () => {
  const rss = `<rss version="2.0"><channel><item><title>Research &amp; tools</title>
    <link>https://publisher.example/story?utm_source=feed&amp;edition=ai#top</link>
    <description><![CDATA[<p>New &amp; useful.</p><script>bad()</script>]]></description>
    <pubDate>${time}</pubDate></item></channel></rss>`;
  const [record] = parseFeed(rss, source, now);
  assert.equal(record.title, "Research & tools");
  assert.equal(record.excerpt, "New & useful.");
  assert.equal(record.url, "https://publisher.example/story?edition=ai");
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom</title>
    <link rel="self" href="https://publisher.example/feed"/><link href='https://publisher.example/atom' rel='alternate'/>
    <updated>${time}</updated><summary>&lt;p&gt;Plain text&lt;/p&gt;</summary></entry></feed>`;
  const [entry] = parseFeed(atom, source, now);
  assert.equal(entry.url, "https://publisher.example/atom");
  assert.equal(entry.excerpt, "Plain text");
});

test("combines the same launch across publishers and retains original coverage", () => {
  const first = article("OpenAI releases GPT-6.1 Sol for enterprise developers", "original", "openai");
  const second = article("OpenAI launches GPT-6.1 Sol for enterprise developers today", "report");
  const initial = clusterArticles([first], [], now);
  const [story, extra] = clusterArticles([second, first, first], initial, now);
  assert.equal(extra, undefined);
  assert.equal(story.id, initial[0].id);
  assert.equal(story.sourceCount, 2);
  assert.deepEqual(story.articles.map(item => item.url), [second.url, first.url]);
});

test("does not group a different model version or a different event", () => {
  const stories = clusterArticles([
    article("OpenAI releases GPT-6.1 Sol for enterprise developers", "launch"),
    article("OpenAI releases GPT-6.2 Sol for enterprise developers", "next"),
    article("OpenAI announces new pricing for GPT-6.1 Sol for enterprise developers", "price"),
  ], [], now);
  assert.equal(stories.length, 3);
});

test("groups launch coverage with differently worded headlines while separating named variants", () => {
  const official = article("Introducing Gemini 4 Hydrogen", "announcement", "deepmind");
  const first = article("Google rolls out Gemini 4 Hydrogen, finally replacing 3.8 Flash", "review");
  const second = {
    ...article("Google’s new Gemini model is better at understanding complicated questions", "feature", "verge"),
    excerpt: "Google says its new Gemini 4 Hydrogen model can give more helpful answers to complex questions.",
  };
  const different = article("Introducing Gemini 4 Carbon", "another");
  const price = article("Google updates pricing for Gemini 4 Hydrogen", "price");
  const stories = clusterArticles([official, first, second, different, price], [], now);
  assert.equal(stories.length, 3);
  assert.deepEqual(new Set(stories.find(story => story.sourceCount === 3).articles.map(item => item.url)),
    new Set([official.url, first.url, second.url]));
});

test("groups versioned arXiv URLs for the same paper", () => {
  const stories = clusterArticles([
    { ...article("Original title", "first", "arxiv"), url: "https://arxiv.org/abs/2611.12345v1" },
    { ...article("Revised title", "second", "arxiv"), url: "https://arxiv.org/pdf/2611.12345v2.pdf" },
    { ...article("Original title", "third", "arxiv"), url: "https://arxiv.org/abs/2611.12346" },
  ], [], now);
  assert.deepEqual(stories.map(story => story.articles.length).sort(), [1, 2]);
});

test("keeps cached coverage after failure and reports stale source state", async () => {
  const rss = `<rss><channel><item><title>AI release</title><link>https://publisher.example/release</link>
    <pubDate>${time}</pubDate></item></channel></rss>`;
  const first = await collectNews(undefined, { now, sources: [source], fetchImpl: async () => new Response(rss, { headers: { etag: "test-tag" } }) });
  const fail = await collectNews(first, {
    now: now + 1000, sources: [source], fetchImpl: async (_url, { headers }) => {
      assert.equal(headers["if-none-match"], "test-tag");
      return new Response("unavailable", { status: 503 });
    },
  });
  assert.equal(fail.updatedAt, first.updatedAt);
  assert.equal(fail.stories[0].id, first.stories[0].id);
  assert.equal(publicNews(fail, [source]).sources[0].state, "stale");
});

test("ingests targeted advisories and only publishes relevant official policy results", () => {
  const security = FEEDS.find(source => source.id === "githubsecurity");
  const advisory = { summary: "vLLM request validation vulnerability", ghsa_id: "GHSA-1111-2222-3333",
    cve_id: "CVE-2026-12345", published_at: time, html_url: "https://github.com/advisories/GHSA-1111-2222-3333",
    severity: "high", description: "An unauthenticated client can bypass the affected validation." };
  const [record, excluded] = parseSource(JSON.stringify([advisory, { ...advisory, withdrawn_at: time }]), security, now);
  assert.equal(excluded, undefined);
  assert.equal(record.topic, "policy");
  assert.equal(record.record.severity, "high");
  assert.match(record.title, /CVE-2026-12345/);
  assert.match(record.excerpt, /Severity: high/);

  const policy = FEEDS.find(source => source.id === "federalregister");
  const rule = { title: "Request for Information", type: "Notice", publication_date: "2026-11-15",
    html_url: "https://www.federalregister.gov/documents/ai-notice", agency: "Agency",
    abstract: "Comments are invited on artificial intelligence models.",
    agencies: [{ name: "Example Agency" }], comments_close_on: "2026-11-18" };
  const results = parseSource(JSON.stringify({ results: [rule, { ...rule, title: "Annual fees", abstract: "Annual fee schedule." }] }), policy, now);
  assert.equal(results.length, 1);
  assert.match(results[0].title, /Example Agency/);
  assert.deepEqual(results[0].record.deadlines, ["2026-11-18"]);
});

test("labels generic Atom release titles with their project", () => {
  const release = FEEDS.find(source => source.id === "vllm");
  const atom = `<feed><entry><title>v1.2.3</title><link rel="alternate" href="https://github.com/vllm-project/vllm/releases/tag/v1.2.3"/>
    <updated>${time}</updated><content type="html">&lt;p&gt;Breaking change in the client.&lt;/p&gt;</content></entry></feed>`;
  const [entry] = parseSource(atom, release, now);
  assert.equal(entry.title, "vLLM v1.2.3");
  assert.equal(entry.excerpt, "Breaking change in the client.");
  assert.equal(entry.topic, "tools");
});

test("ranks an active serious advisory above a newer rumor and preserves published evidence reasons", () => {
  const risk = { ...article("Critical vLLM vulnerability (CVE-2026-12345)", "risk", "githubsecurity"),
    date: "2026-11-14T12:00:00Z", topic: "policy", record: { severity: "critical" },
    excerpt: "The vulnerability is actively exploited. Maintainers published a patch." };
  const rumor = { ...article("OpenAI rumored to launch a new model", "rumor", "verge"), excerpt: "The plans remain speculative." };
  const [first, second] = clusterArticles([rumor, risk], [], now);
  assert.equal(first.articles[0].source, "githubsecurity");
  assert.deepEqual([first.priority.impact.points, first.priority.urgency.points, first.priority.evidence.points], [5, 5, 5]);
  assert.equal(first.priority.evidence.label, "Official security advisory");
  assert.equal(second.priority.urgency.points, 0);

  const copy = { ...risk, source: "ars", url: "https://publisher.example/related",
    title: "Maintainers ship patched packages for CVE-2026-12345" };
  const groups = clusterArticles([risk, copy, { ...copy, url: "https://publisher.example/separate", title: "Fix for CVE-2026-54321" }], [], now);
  assert.deepEqual(groups.map(group => group.articles.length).sort(), [1, 2]);
});

test("uses dates for urgency and credits distinct evidence without crediting copied excerpts", () => {
  const primary = { ...article("OpenAI retires GPT-6.1 Sol API on November 17, 2026", "old-docs", "openai"),
    date: "2026-11-11T12:00:00Z",
    excerpt: "Existing users need to migrate to the replacement API before the service retirement in November." };
  const sourced = { ...primary, source: "ars", url: "https://publisher.example/retirement",
    excerpt: "The retirement means shops running the older API endpoint have just days to switch their applications." };
  const copied = { ...sourced, excerpt: primary.excerpt };
  const [story] = clusterArticles([primary, sourced], [], now);
  assert.equal(story.priority.urgency.label, "Deadline within 3 days");
  assert.equal(story.priority.evidence.label, "Primary source and reporting");
  assert.equal(story.rank, story.priority.score);
  const [sameCopy] = clusterArticles([primary, copied], [], now);
  assert.notEqual(sameCopy.priority.evidence.label, "Primary source and reporting");

  const unrelated = { ...primary, title: "OpenAI announced an update on October 30, 2026", excerpt: "The launch happened last month." };
  const [announcement] = clusterArticles([unrelated], [], now);
  assert.equal(announcement.priority.urgency.points, 0);
});

test("limits refresh concurrency and retains the configured source order", async () => {
  const feeds = Array.from({ length: 12 }, (_, index) => ({ ...source, id: "fixture-" + index,
    url: "https://publisher.example/" + index }));
  let inFlight = 0;
  let maximum = 0;
  const result = await collectNews(undefined, { sources: feeds, now, fetchImpl: async () => {
    maximum = Math.max(maximum, ++inFlight);
    await new Promise(resolve => setTimeout(resolve, 1));
    inFlight--;
    return new Response("<rss><channel></channel></rss>");
  } });
  assert.equal(maximum, 5);
  assert.deepEqual(Object.keys(result.feeds), feeds.map(feed => feed.id));
});
