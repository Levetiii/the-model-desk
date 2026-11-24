export const BRIEF_PROVIDERS = {
  openai: { name: "OpenAI", origin: "https://api.openai.com" },
  anthropic: { name: "Anthropic", origin: "https://api.anthropic.com" },
  google: { name: "Google Gemini", origin: "https://generativelanguage.googleapis.com" },
};

export class BriefError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function providerHeaders(provider, key) {
  const headers = { Accept: "application/json" };
  if (provider === "openai") headers.Authorization = "Bearer " + key;
  else if (provider === "anthropic") {
    headers["x-api-key"] = key;
    headers["anthropic-version"] = "2023-06-01";
  } else headers["x-goog-api-key"] = key;
  return headers;
}

async function providerRequest(provider, key, path, fetchProvider, body) {
  const client = BRIEF_PROVIDERS[provider];
  const headers = providerHeaders(provider, key);
  if (body) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetchProvider(client.origin + path, {
      method: body ? "POST" : "GET",
      headers, body: body ? JSON.stringify(body) : undefined,
      redirect: "error", signal: AbortSignal.timeout(body ? 27_000 : 9_000),
    });
  } catch {
    throw new BriefError(502, client.name + " could not be reached. Check your provider and try again.");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403) {
      throw new BriefError(422, client.name + " denied access. Check the key, project permissions, and selected model.");
    }
    if (response.status === 429 || response.status === 402) {
      throw new BriefError(429, client.name + " reported a quota or billing limit.");
    }
    if (response.status === 400 || response.status === 404) {
      throw new BriefError(422, client.name + " could not use this model. Check its ID and structured-output support.");
    }
    throw new BriefError(502, client.name + " is temporarily unavailable.");
  }
  try {
    const text = await response.text();
    if (text.length > 180_000) throw new Error("Provider response exceeds limit");
    return JSON.parse(text);
  } catch {
    throw new BriefError(502, client.name + " returned an unreadable response.");
  }
}

export async function probeBriefProvider(provider, key, model, fetchProvider = fetch) {
  const id = model ? "/" + encodeURIComponent(model) : "";
  let path = "/v1/models" + id;
  if (provider === "anthropic" && !model) path += "?limit=1";
  if (provider === "google") path = "/v1beta/models" + (id || "?pageSize=1");
  const response = await providerRequest(provider, key, path, fetchProvider);
  if (provider === "google" && model && !response.supportedGenerationMethods?.includes("generateContent")) {
    throw new BriefError(422, "Choose a Gemini model that supports text generation.");
  }
}

function googleSchema(schema) {
  if (schema.type === "object") {
    return { type: "object", properties: Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, googleSchema(value)])), required: schema.required };
  }
  if (schema.type === "array") return { type: "array", items: googleSchema(schema.items) };
  return schema;
}

export async function callBriefProvider(job, key, task, fetchProvider = fetch) {
  const { provider, model } = job;
  const { name, schema, system, user, maxOutputTokens } = task;
  let path;
  let body;
  if (provider === "openai") {
    path = "/v1/responses";
    body = {
      model, store: false, instructions: system, input: user, max_output_tokens: maxOutputTokens,
      text: { format: { type: "json_schema", name, schema, strict: true } },
    };
  } else if (provider === "anthropic") {
    path = "/v1/messages";
    body = {
      model, max_tokens: maxOutputTokens, system, messages: [{ role: "user", content: user }],
      output_config: { format: { type: "json_schema", schema } },
    };
  } else {
    path = "/v1beta/models/" + encodeURIComponent(model) + ":generateContent";
    body = {
      systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: googleSchema(schema), maxOutputTokens },
    };
  }
  const response = await providerRequest(provider, key, path, fetchProvider, body);
  let output;
  if (provider === "openai" && response.status === "completed") {
    output = response.output?.filter(item => item.type === "message").flatMap(item => item.content ?? [])
      .filter(item => item.type === "output_text").map(item => item.text).join("");
  } else if (provider === "anthropic" && response.stop_reason === "end_turn") {
    output = response.content?.filter(item => item.type === "text").map(item => item.text).join("");
  } else if (provider === "google" && response.candidates?.[0]?.finishReason === "STOP") {
    output = response.candidates[0].content?.parts?.filter(item => !item.thought).map(item => item.text ?? "").join("");
  }
  try {
    return JSON.parse(output);
  } catch {
    throw new BriefError(502, BRIEF_PROVIDERS[provider].name + " did not return a complete structured result. Try another model if this repeats.");
  }
}
