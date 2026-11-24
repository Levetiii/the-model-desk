import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { ASSETS } from "./server/static.mjs";

const assetEntries = await Promise.all(Object.entries(ASSETS).map(async ([path, [file, type]]) => {
  const bytes = await readFile(new URL("./public/" + file, import.meta.url));
  return [path, { type, data: bytes.toString("base64") }];
}));

// These internal, flat modules use named imports in Node. The Sites artifact is one ES module.
const modules = ["ranking.mjs", "news.mjs", "documents.mjs", "static.mjs", "providers.mjs", "brief-engine.mjs", "brief-api.mjs", "worker.mjs"];
const sources = await Promise.all(modules.map(async path => {
  const code = await readFile(new URL("./server/" + path, import.meta.url), "utf8");
  return code.replace(/^import \{[^\n]+\} from "\.\/[\w-]+\.mjs";\r?\n/gm, "");
}));
const workerDir = new URL("./dist/server/", import.meta.url);
await mkdir(workerDir, { recursive: true });
await mkdir(new URL("./dist/.openai/", import.meta.url), { recursive: true });
await writeFile(new URL("index.js", workerDir), "const staticAssets = " + JSON.stringify(Object.fromEntries(assetEntries)) + ";\n" + sources.join("\n"));
await copyFile(new URL("./.openai/hosting.json", import.meta.url), new URL("./dist/.openai/hosting.json", import.meta.url));
console.log("Built dist/server/index.js");
