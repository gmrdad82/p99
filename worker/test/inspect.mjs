import { writeFileSync } from "node:fs";
import { sourceMapOf } from "./coverage-lines.mjs";

export const V8_FLAGS = "--allow-natives-syntax";

export const COLLECT =
  "JSON.stringify(%DebugCollectCoverage().map((ranges) => ({ source: ranges.script, ranges: ranges.map(({ start, end, count }) => ({ startOffset: start, endOffset: end, count })) })))";

export function v8Flags(env) {
  const flags = (env.MINIFLARE_WORKERD_V8_FLAGS || "").split(" ").filter(Boolean);
  return flags.includes(V8_FLAGS) ? flags.join(" ") : [...flags, V8_FLAGS].join(" ");
}

export function matchScripts(taken, sources, startup = []) {
  const bySource = new Map(taken.map((entry) => [entry.source, entry.ranges]));
  const before = new Map(startup.map((entry) => [entry.source, entry.ranges]));
  const scripts = [];
  for (const { url, sourceMapURL, source } of sources) {
    const ranges = bySource.get(source);
    const early = before.get(source);
    if (!ranges && !early) continue;
    scripts.push({ url, sourceMapURL, source, functions: ranges ? [{ ranges }] : [], ...(early ? { startup: [{ ranges: early }] } : {}) });
  }
  return scripts;
}

export const CALL_LIMIT = 60_000;

export async function coverWorker(port, searchDir, { connect = open, limit = CALL_LIMIT } = {}) {
  let socket = null;
  for (let i = 0; i < 300 && !socket; i++) {
    socket = await connect(`ws://127.0.0.1:${port}/ws`).catch(() => null);
    if (!socket) await new Promise((r) => setTimeout(r, 200));
  }
  if (!socket) throw new Error(`the Worker's inspector did not answer on ${port}`);
  let next = 1_000_000;
  let context = null;
  let counting = false;
  let reloaded = false;
  let gone = null;
  const waiting = new Map();
  const parsed = new Map();
  const drop = (why) => {
    if (gone) return;
    gone = why;
    for (const call of waiting.values()) call.reject(new Error(`${call.method}: ${why}`));
    waiting.clear();
  };
  socket.addEventListener("close", () => drop(`the Worker's inspector on ${port} closed`));
  socket.addEventListener("error", () => drop(`the Worker's inspector on ${port} failed`));
  socket.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === "Debugger.scriptParsed") parsed.set(msg.params.scriptId, msg.params);
    if (msg.method === "Runtime.executionContextCreated") context = msg.params.context.id;
    if (msg.method === "Runtime.executionContextsCleared" && counting) reloaded = true;
    const done = msg.id !== undefined && waiting.get(msg.id);
    if (!done) return;
    waiting.delete(msg.id);
    if (msg.error) done.reject(new Error(`${done.method}: ${msg.error.message}`));
    else done.resolve(msg.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      if (gone) return reject(new Error(`${method}: ${gone}`));
      const id = next++;
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`${method}: the Worker's inspector on ${port} gave no answer in ${limit} ms`));
      }, limit);
      const settle = (fn) => (value) => {
        clearTimeout(timer);
        fn(value);
      };
      waiting.set(id, { resolve: settle(resolve), reject: settle(reject), method });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", { contextId: context, expression, returnByValue: true });
    if (exceptionDetails) throw new Error(`Runtime.evaluate: ${exceptionDetails.exception?.description || exceptionDetails.text}`);
    return result.value;
  };
  await send("Runtime.enable");
  for (let i = 0; i < 100 && context === null; i++) await new Promise((r) => setTimeout(r, 100));
  if (context === null) throw new Error(`the Worker's inspector on ${port} named no execution context`);
  const startup = JSON.parse(await evaluate(COLLECT));
  await evaluate("%DebugToggleBlockCoverage(true)");
  counting = true;
  return {
    async save(file) {
      if (reloaded) {
        socket.close();
        throw new Error(`the Worker on inspector ${port} reloaded while its coverage was counted; a file under worker/ changed during the run`);
      }
      const taken = JSON.parse(await evaluate(COLLECT));
      await send("Debugger.enable");
      const sources = [];
      for (const [scriptId, info] of parsed) {
        if (!info.url || info.url.startsWith("node:") || info.url.startsWith("cloudflare:")) continue;
        const { scriptSource } = await send("Debugger.getScriptSource", { scriptId }).catch(() => ({}));
        if (scriptSource) sources.push({ url: info.url, sourceMapURL: info.sourceMapURL || "", source: scriptSource });
      }
      const scripts = matchScripts(taken, sources, startup).map((script) => {
        let found = null;
        try {
          found = sourceMapOf(script, searchDir);
        } catch (error) {
          console.error(`coverage: ${script.url}: ${error.message}`);
        }
        return found ? { ...script, map: found.map, mapDir: found.dir } : script;
      });
      socket.close();
      writeFileSync(file, JSON.stringify({ kind: "workerd", loaded: true, scripts }));
      return scripts.length;
    },
  };
}

function open(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { origin: "http://127.0.0.1" } });
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", () => reject(new Error(`no inspector at ${url}`)), { once: true });
  });
}
