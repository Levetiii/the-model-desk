const storageAge = 2 * 24 * 60 * 60;

async function cachedNews(request, context) {
  const cache = globalThis.caches?.default;
  const key = new Request(new URL("/__model_desk_feed_v4", request.url), { method: "GET" });
  let previous;
  try {
    const response = await cache?.match(key);
    if (response) previous = await response.json();
    else {
      const oldCache = await cache?.match(new Request(new URL("/__model_desk_feed_v3", request.url), { method: "GET" }));
      previous = await oldCache?.json();
      if (previous) previous.checkedAt = null;
    }
  } catch {
    previous = undefined;
  }
  const lastCheck = Date.parse(previous?.checkedAt);
  const hasLiveSource = Object.values(previous?.feeds ?? {}).some(feed => feed.state === "live");
  if (FEEDS.every(source => previous?.feeds?.[source.id]) &&
      Number.isFinite(lastCheck) && Date.now() - lastCheck < (hasLiveSource ? CACHE_AGE : MINUTE)) {
    return previous;
  }
  const snapshot = await collectNews(previous);
  if (cache) {
    const copy = Response.json(snapshot, { headers: { "Cache-Control": "public, max-age=" + storageAge } });
    const save = cache.put(key, copy).catch(() => {});
    if (context?.waitUntil) context.waitUntil(save);
    else await save;
  }
  return snapshot;
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    if (isBriefRoute(url.pathname)) {
      const owner = request.headers.get("oai-authenticated-user-id");
      return handleBriefApi(request, env, owner, () => cachedNews(request, context));
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    if (url.pathname === "/api/news") {
      const response = newsResponse(await cachedNews(request, context));
      return request.method === "HEAD" ? new Response(null, { headers: response.headers, status: response.status }) : response;
    }
    const asset = staticAssets[url.pathname];
    if (!Object.hasOwn(staticAssets, url.pathname)) return new Response("Not found", { status: 404 });
    const bytes = request.method === "HEAD" ? null : Uint8Array.from(atob(asset.data), char => char.charCodeAt(0));
    return new Response(bytes, { headers: assetHeaders(url.pathname, asset.type) });
  },
};
