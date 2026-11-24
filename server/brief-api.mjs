import { BRIEF_PROVIDERS, BriefError, probeBriefProvider, callBriefProvider } from "./providers.mjs";
import { evidencePacket, composeBrief } from "./brief-engine.mjs";
import { FEEDS, nearbyIndependentCoverage } from "./news.mjs";
import { enrichOriginalDocuments } from "./documents.mjs";

const BRIEF_ROUTES = new Set(["/api/brief", "/api/brief-settings", "/api/model-connections"]);
const BRIEF_FORMAT = "brief-v2";
const VAULT_FORMAT = "model-desk-vault-v1";
const DEFAULT_DAILY_LIMIT = 5;
const DAY_MS = 86_400_000;
const LEASE_MS = 120_000;
const RETRY_MS = 20_000;
const encoder = new TextEncoder();

export function isBriefRoute(path) {
  return BRIEF_ROUTES.has(path);
}

function briefJson(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

async function jsonInput(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) {
    throw new BriefError(415, "Send the form as JSON.");
  }
  const maxSize = 5000;
  if (!request.body || Number(request.headers.get("content-length")) > maxSize) {
    throw new BriefError(413, "This settings form is too large.");
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxSize) throw new BriefError(413, "This settings form is too large.");
      body += decoder.decode(next.value, { stream: true });
    }
    const data = JSON.parse(body + decoder.decode());
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid request");
    return data;
  } catch (error) {
    if (error instanceof BriefError) throw error;
    throw new BriefError(400, "This form could not be read.");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function base64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function fromBase64(value) {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

async function importVault(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new BriefError(503, "The model key vault is unavailable.");
  }
  return crypto.subtle.importKey("raw", fromBase64(value), "AES-GCM", false, ["encrypt", "decrypt"]);
}

function vaultOptions(owner, provider, iv) {
  return { name: "AES-GCM", iv, additionalData: encoder.encode(JSON.stringify([VAULT_FORMAT, owner, provider])) };
}

async function persistConnection(db, vault, owner, provider, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(vaultOptions(owner, provider, iv), vault, encoder.encode(value));
  await db.prepare(`INSERT INTO model_connections (owner, provider, ciphertext, nonce, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (owner, provider) DO UPDATE SET ciphertext = excluded.ciphertext, nonce = excluded.nonce, updated_at = excluded.updated_at`)
    .bind(owner, provider, base64(ciphertext), base64(iv), Date.now()).run();
}

async function connectionKey(db, vault, owner, provider) {
  const row = await db.prepare("SELECT ciphertext, nonce FROM model_connections WHERE owner = ? AND provider = ?").bind(owner, provider).first();
  if (!row) throw new BriefError(422, "Connect " + BRIEF_PROVIDERS[provider].name + " in model settings.");
  try {
    const plaintext = await crypto.subtle.decrypt(vaultOptions(owner, provider, fromBase64(row.nonce)), vault, fromBase64(row.ciphertext));
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new BriefError(422, "This connection could not be opened. Reconnect " + BRIEF_PROVIDERS[provider].name + ".");
  }
}

function ensureProvider(provider) {
  if (typeof provider !== "string" || !Object.hasOwn(BRIEF_PROVIDERS, provider)) {
    throw new BriefError(400, "Choose a supported provider.");
  }
  return provider;
}

function cleanKey(value) {
  const key = typeof value === "string" ? value.trim() : "";
  if (key.length < 12 || key.length > 500 || !/^[\x21-\x7e]+$/.test(key)) {
    throw new BriefError(400, "Enter a valid provider API key.");
  }
  return key;
}

function stageSettings(data) {
  const provider = ensureProvider(data?.provider);
  const model = typeof data.model === "string" ? data.model.trim().replace(/^models\//, "") : "";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(model)) {
    throw new BriefError(400, "Enter the exact model ID from your provider.");
  }
  return { provider, model };
}

async function modelSettings(db, owner) {
  const row = await db.prepare("SELECT * FROM brief_settings WHERE owner = ?").bind(owner).first();
  if (!row) return null;
  return {
    extract: { provider: row.extract_provider, model: row.extract_model },
    write: { provider: row.write_provider, model: row.write_model },
    dailyLimit: row.daily_limit,
  };
}

async function attemptCount(db, owner) {
  const row = await db.prepare("SELECT COUNT(*) AS total FROM brief_attempts WHERE owner = ? AND started_at > ?")
    .bind(owner, Date.now() - DAY_MS).first();
  return row.total;
}

async function settingsResponse(db, owner) {
  const [settings, connections, attempts] = await Promise.all([
    modelSettings(db, owner),
    db.prepare("SELECT provider, updated_at FROM model_connections WHERE owner = ?").bind(owner).all(),
    attemptCount(db, owner),
  ]);
  const linked = new Map(connections.results.map(row => [row.provider, row.updated_at]));
  return {
    providers: Object.entries(BRIEF_PROVIDERS).map(([id, { name }]) =>
      ({ id, name, connected: linked.has(id), checkedAt: linked.has(id) ? new Date(linked.get(id)).toISOString() : null })),
    settings, dailyLimit: settings?.dailyLimit ?? DEFAULT_DAILY_LIMIT, attempts,
    ready: Boolean(settings && linked.has(settings.extract.provider) && linked.has(settings.write.provider)),
  };
}

function requestStoryId(value) {
  if (typeof value !== "string" || !/^story-[a-z0-9]{1,20}$/.test(value)) throw new BriefError(400, "Choose a valid story.");
  return value;
}

async function lastBrief(db, owner, storyId) {
  const row = await db.prepare("SELECT result FROM brief_jobs WHERE owner = ? AND story_id = ? AND state = 'ready' ORDER BY finished_at DESC LIMIT 1")
    .bind(owner, storyId).first();
  return row?.result ? JSON.parse(row.result) : null;
}

async function cacheFingerprint(storyId, docs, settings) {
  const stages = [settings.extract, settings.write];
  const input = encoder.encode(JSON.stringify([BRIEF_FORMAT, storyId, docs, stages]));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function generateBrief(db, vault, owner, storyId, getNews, call, fetchDocuments) {
  const snapshot = await getNews();
  const story = snapshot.stories.find(story => story.id === storyId);
  if (!story) throw new BriefError(404, "This story has left the live feed. Its original links are still available in the reader.");
  const settings = await modelSettings(db, owner);
  if (!settings) throw new BriefError(422, "Choose an extraction and writing model in model settings.");
  const articles = [...story.articles, ...nearbyIndependentCoverage(story, snapshot)];
  const initial = evidencePacket({ ...story, articles }, FEEDS);
  if (!initial.length) throw new BriefError(422, "There is no supporting source text for this story.");
  const documents = await enrichOriginalDocuments(initial, articles, fetchDocuments);
  const cacheId = await cacheFingerprint(story.id, documents, settings);
  const cached = await db.prepare("SELECT state, result FROM brief_jobs WHERE owner = ? AND cache_id = ?")
    .bind(owner, cacheId).first();
  if (cached?.state === "ready") return { brief: JSON.parse(cached.result), cached: true };

  // Check both connections before reserving a paid attempt.
  for (const provider of new Set([settings.extract.provider, settings.write.provider])) {
    await connectionKey(db, vault, owner, provider);
  }
  const now = Date.now();
  const lease = crypto.randomUUID();
  const claimed = await db.prepare(`INSERT INTO brief_jobs (owner, story_id, cache_id, state, lease, started_at)
    VALUES (?, ?, ?, 'running', ?, ?)
    ON CONFLICT (owner, cache_id) DO UPDATE SET state = 'running', lease = excluded.lease, started_at = excluded.started_at
    WHERE (brief_jobs.state = 'running' AND brief_jobs.started_at < ?) OR
          (brief_jobs.state = 'failed' AND brief_jobs.started_at < ?)
    RETURNING lease`).bind(owner, story.id, cacheId, lease, now, now - LEASE_MS, now - RETRY_MS).first();
  if (!claimed) {
    const latest = await db.prepare("SELECT state, result FROM brief_jobs WHERE owner = ? AND cache_id = ?").bind(owner, cacheId).first();
    if (latest?.state === "ready") return { brief: JSON.parse(latest.result), cached: true };
    throw new BriefError(409, "A brief for this evidence is in progress or was just attempted. Check back shortly.");
  }

  try {
    // This write checks the limit and reserves an attempt in one SQLite statement.
    const reserved = await db.prepare(`INSERT INTO brief_attempts (owner, id, started_at)
      SELECT ?, ?, ? WHERE
      (SELECT COUNT(*) FROM brief_attempts WHERE owner = ? AND started_at > ?) <
      (SELECT daily_limit FROM brief_settings WHERE owner = ?)
      RETURNING id`).bind(owner, lease, now, owner, now - DAY_MS, owner).first();
    if (!reserved) throw new BriefError(429, "Your brief limit for the last 24 hours has been reached. Existing briefs are still available.");
    const draft = await composeBrief(story.title, documents, async (stage, task) => {
      const job = settings[stage];
      const secret = await connectionKey(db, vault, owner, job.provider);
      return call(job, secret, task);
    });
    const brief = { ...draft, createdAt: new Date().toISOString(), models: settings };
    await db.prepare("UPDATE brief_jobs SET state = 'ready', result = ?, finished_at = ? WHERE owner = ? AND cache_id = ? AND lease = ?")
      .bind(JSON.stringify(brief), Date.now(), owner, cacheId, lease).run();
    return { brief, cached: false };
  } catch (error) {
    await db.prepare("UPDATE brief_jobs SET state = 'failed' WHERE owner = ? AND cache_id = ? AND lease = ?").bind(owner, cacheId, lease).run();
    throw error;
  }
}

export async function handleBriefApi(request, env, owner, getNews, { probe = probeBriefProvider, call = callBriefProvider, fetchDocuments = fetch } = {}) {
  try {
    if (!owner) throw new BriefError(401, "Sign in with ChatGPT to use AI briefs.");
    const url = new URL(request.url);
    const method = request.method;
    if (method !== "GET" && request.headers.get("origin") !== url.origin) {
      throw new BriefError(403, "Open model settings on this site to make changes.");
    }
    const db = env?.DB;
    if (!db) throw new BriefError(503, "The brief database is unavailable.");
    if (url.pathname === "/api/brief-settings" && method === "GET") {
      return briefJson(await settingsResponse(db, owner));
    }
    if (url.pathname === "/api/brief" && method === "GET") {
      return briefJson({ brief: await lastBrief(db, owner, requestStoryId(url.searchParams.get("story"))) });
    }
    if (url.pathname === "/api/model-connections" && method === "DELETE") {
      const provider = ensureProvider(url.searchParams.get("provider"));
      await db.prepare("DELETE FROM model_connections WHERE owner = ? AND provider = ?").bind(owner, provider).run();
      return briefJson(await settingsResponse(db, owner));
    }
    if (method !== "POST") throw new BriefError(405, "This operation is unavailable.");
    const data = await jsonInput(request);
    const vault = await importVault(env.MODEL_DESK_VAULT_KEY);
    if (url.pathname === "/api/model-connections") {
      const provider = ensureProvider(data.provider);
      const key = cleanKey(data.key);
      await probe(provider, key);
      await persistConnection(db, vault, owner, provider, key);
      return briefJson(await settingsResponse(db, owner));
    }
    if (url.pathname === "/api/brief-settings") {
      const extract = stageSettings(data.extract);
      const write = stageSettings(data.write);
      const limit = data.dailyLimit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 30) throw new BriefError(400, "Choose a brief limit from 1 to 30.");
      const previous = await modelSettings(db, owner);
      await Promise.all(Object.entries({ extract, write }).map(async ([stage, job]) => {
        const key = await connectionKey(db, vault, owner, job.provider);
        if (previous?.[stage].provider !== job.provider || previous?.[stage].model !== job.model) {
          await probe(job.provider, key, job.model);
        }
      }));
      await db.prepare(`INSERT INTO brief_settings (owner, extract_provider, extract_model, write_provider, write_model, daily_limit)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (owner) DO UPDATE SET extract_provider = excluded.extract_provider,
        extract_model = excluded.extract_model, write_provider = excluded.write_provider, write_model = excluded.write_model,
        daily_limit = excluded.daily_limit`).bind(owner, extract.provider, extract.model, write.provider, write.model, limit).run();
      return briefJson(await settingsResponse(db, owner));
    }
    return briefJson(await generateBrief(db, vault, owner, requestStoryId(data.story), getNews, call, fetchDocuments));
  } catch (error) {
    if (error instanceof BriefError) return briefJson({ error: error.message }, error.status);
    console.error("Model Desk brief operation failed");
    return briefJson({ error: "The brief service couldn’t complete this request. Try again shortly." }, 500);
  }
}
