import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import { Readable } from "node:stream";
import { collectNews, newsResponse, CACHE_AGE, FEEDS, FEED_EVIDENCE_VERSION } from "./news.mjs";
import { ASSETS, assetHeaders } from "./static.mjs";
import { handleBriefApi, isBriefRoute } from "./brief-api.mjs";
import { localDatabase } from "./local-db.mjs";

const port = Number(process.env.MODEL_DESK_PORT ?? "4173");
const origin = "http://127.0.0.1:" + port;
const localEnv = { DB: localDatabase(), MODEL_DESK_VAULT_KEY: randomBytes(32).toString("base64") };
const cachePath = new URL("../.news-cache-v2.json", import.meta.url);
const tempPath = new URL("../.news-cache-v2.tmp", import.meta.url);
let previous;
try {
  previous = JSON.parse(await readFile(cachePath, "utf8"));
} catch {
  previous = undefined;
}
let pending;

async function currentNews() {
  const live = Object.values(previous?.feeds ?? {}).some(feed => feed.state === "live");
  if (previous?.evidenceVersion === FEED_EVIDENCE_VERSION && FEEDS.every(source => previous?.feeds?.[source.id]) &&
      Date.now() - Date.parse(previous.checkedAt) < (live ? CACHE_AGE : 60_000)) return previous;
  pending ??= collectNews(previous).then(async snapshot => {
    previous = snapshot;
    try {
      await writeFile(tempPath, JSON.stringify(snapshot));
      await rename(tempPath, cachePath);
    } catch (error) {
      console.warn("Feed cache could not be written:", error.code);
    }
    return snapshot;
  }).finally(() => { pending = undefined; });
  return pending;
}

const app = createServer(async (request, response) => {
  try {
    if (!["127.0.0.1:" + port, "localhost:" + port].includes(request.headers.host)) {
      return response.writeHead(403).end("Development server only");
    }
    const url = new URL(request.url, request.headers.host.startsWith("localhost:") ? "http://localhost:" + port : origin);
    const path = url.pathname;
    if (isBriefRoute(path)) {
      const options = { method: request.method, headers: request.headers };
      if (request.method === "POST") Object.assign(options, { body: Readable.toWeb(request), duplex: "half" });
      const result = await handleBriefApi(new Request(url, options), localEnv, "local-preview", currentNews);
      response.writeHead(result.status, Object.fromEntries(result.headers)).end(await result.text());
    } else if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
    } else if (path === "/api/news") {
      const result = newsResponse(await currentNews());
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(request.method === "HEAD" ? undefined : await result.text());
    } else if (Object.hasOwn(ASSETS, path)) {
      const [file, type] = ASSETS[path];
      const data = await readFile(new URL("../public/" + file, import.meta.url));
      response.writeHead(200, assetHeaders(path, type)).end(request.method === "HEAD" ? undefined : data);
    } else {
      response.writeHead(404).end("Not found");
    }
  } catch (error) {
    console.error("Request failed:", error.message);
    if (!response.headersSent) response.writeHead(500);
    response.end("Couldn’t serve this request");
  }
});

app.listen(port, "127.0.0.1", () => console.log("The Model Desk: " + origin));
