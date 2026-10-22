import { writeFileSync } from "node:fs";
import { sourceMapOf } from "./coverage-lines.mjs";

export async function coverWorker(port, searchDir) {
  let socket = null;
  for (let i = 0; i < 100 && !socket; i++) {
    socket = await open(`ws://127.0.0.1:${port}/ws`).catch(() => null);
    if (!socket) await new Promise((r) => setTimeout(r, 200));
  }
  if (!socket) throw new Error(`the Worker's inspector did not answer on ${port}`);
  let next = 1_000_000;
  const waiting = new Map();
  const parsed = new Map();
  socket.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === "Debugger.scriptParsed") parsed.set(msg.params.scriptId, msg.params);
    const done = msg.id !== undefined && waiting.get(msg.id);
    if (!done) return;
    waiting.delete(msg.id);
    if (msg.error) done.reject(new Error(`${done.method}: ${msg.error.message}`));
    else done.resolve(msg.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = next++;
      waiting.set(id, { resolve, reject, method });
      socket.send(JSON.stringify({ id, method, params }));
    });
  await send("Profiler.enable");
  await send("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
  return {
    async save(file) {
      const { result } = await send("Profiler.takePreciseCoverage");
      await send("Debugger.enable");
      const scripts = [];
      for (const entry of result) {
        if (!entry.url || entry.url.startsWith("node:") || entry.url.startsWith("cloudflare:")) continue;
        const { scriptSource } = await send("Debugger.getScriptSource", { scriptId: entry.scriptId }).catch(() => ({}));
        if (!scriptSource) continue;
        const info = parsed.get(entry.scriptId) || {};
        const script = { url: entry.url, sourceMapURL: info.sourceMapURL || "", source: scriptSource, functions: entry.functions };
        let found = null;
        try {
          found = sourceMapOf(script, searchDir);
        } catch (error) {
          console.error(`coverage: ${entry.url}: ${error.message}`);
        }
        scripts.push(found ? { ...script, map: found.map, mapDir: found.dir } : script);
      }
      await send("Profiler.stopPreciseCoverage").catch(() => {});
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
