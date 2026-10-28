import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { chmodSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const MARY = { email: "mary.moves@example.com", name: "Mary Jackson" };

function binary(root) {
  if (process.env.P99_BIN) return process.env.P99_BIN;
  const built = ["release", "debug"]
    .map((profile) => join(root, "..", "target", profile, "p99"))
    .filter((file) => existsSync(file))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (built.length === 0) throw new Error("no p99 binary to drive; run cargo build first or set P99_BIN");
  return built[0];
}

function held(base, count) {
  const waiting = [];
  const forward = async (request, bytes) => {
    const headers = Object.fromEntries(Object.entries(request.headers).filter(([name]) => !["host", "connection", "content-length"].includes(name)));
    const answer = await fetch(base + request.url, { method: request.method, headers, body: bytes.length > 0 ? bytes : undefined });
    return { status: answer.status, type: answer.headers.get("content-type"), body: Buffer.from(await answer.arrayBuffer()) };
  };
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", async () => {
      const bytes = Buffer.concat(chunks);
      const send = ({ status, type, body }) => {
        response.writeHead(status, type ? { "content-type": type } : {});
        response.end(body);
      };
      if (request.method === "POST" && new URL(request.url, base).pathname.endsWith("/v1/move")) {
        waiting.push(() => forward(request, bytes).then(send, () => send({ status: 502, type: null, body: Buffer.alloc(0) })));
        if (waiting.length === count) for (const go of waiting.splice(0)) go();
        return;
      }
      forward(request, bytes).then(send, () => send({ status: 502, type: null, body: Buffer.alloc(0) }));
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        release: () => {
          for (const go of waiting.splice(0)) go();
        },
        close: () => {
          server.closeAllConnections();
          server.close();
        },
      }),
    ),
  );
}

export async function moveStories({ base, call, check, issueBody, here, keys, root, work }) {
  await check("moves: two CLI sessions moving one card at once both read it in New, and its history ends with exactly one move", async () => {
    const dir = join(work, "moves");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, "home"), { recursive: true });
    const proxy = await held(base, 2);
    try {
      const config = join(dir, "config.toml");
      writeFileSync(
        config,
        [
          'default_space = "local"',
          "[me]",
          `name = "${MARY.name}"`,
          `email = "${MARY.email}"`,
          "[spaces.local]",
          'account_id = "local"',
          'token = ""',
          `key = "${keys.p99}"`,
          `url = "${proxy.url}/_p99"`,
          `[hosts."${here}"]`,
          'space = "local"',
          "",
        ].join("\n"),
      );
      chmodSync(config, 0o600);
      const p99 = binary(root);
      const run = (args) =>
        new Promise((resolve, reject) => {
          const child = spawn(p99, args, {
            stdio: ["ignore", "pipe", "pipe"],
            env: {
              PATH: process.env.PATH,
              HOME: join(dir, "home"),
              XDG_CONFIG_HOME: join(dir, "home"),
              XDG_RUNTIME_DIR: join(dir, "home"),
              P99_CONFIG: config,
              NO_COLOR: "1",
            },
          });
          const out = { stdout: "", stderr: "" };
          child.stdout.on("data", (chunk) => (out.stdout += chunk));
          child.stderr.on("data", (chunk) => (out.stderr += chunk));
          const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
          child.on("error", reject);
          child.on("close", (status) => {
            clearTimeout(timer);
            proxy.release();
            resolve({ status, ...out });
          });
        });

      const listed = await call("GET", `/_p99/v1/board?host=${here}`, { actor: MARY });
      assert.equal(listed.status, 200, JSON.stringify(listed.json));
      const lanes = listed.json.board.lanes;
      assert.deepEqual(lanes.map((l) => l.word), ["new", "planned", "in-progress", "needs-you", "stuck", "landed", "done"]);
      const filed = await call("POST", `/_p99/v1/issues?host=${here}`, { actor: MARY, body: issueBody({ title: "Two tabs move the same report" }) });
      assert.equal(filed.status, 201, JSON.stringify(filed.json));
      const key = filed.json.key;
      const [inbox, doing] = [lanes[0].label, lanes[2].label];

      const both = await Promise.all([run(["move", key, "--to", "in-progress", "--host", here]), run(["move", key, "--to", "in-progress", "--host", here])]);
      const landed = both.filter((r) => r.status === 0);
      const refused = both.filter((r) => r.status !== 0);
      assert.equal(landed.length, 1, JSON.stringify(both));
      assert.equal(refused.length, 1, JSON.stringify(both));
      assert.equal(landed[0].stdout, `${key} is in ${doing}\n`, JSON.stringify(landed[0]));
      for (const r of refused) {
        assert.equal(r.status, 1, JSON.stringify(r));
        assert.equal(r.stdout, "");
        assert.equal(r.stderr, `p99: ${key} moved to ${doing} meanwhile; nothing left to move\n`);
      }

      const thread = await call("GET", `/_p99/v1/issues/${key}?host=${here}`, { actor: MARY });
      assert.equal(thread.status, 200, JSON.stringify(thread.json));
      assert.equal(thread.json.issue.label, doing);
      const moves = thread.json.events.filter((e) => e.kind === "label");
      assert.equal(moves.length, 1, JSON.stringify(thread.json.events));
      assert.deepEqual(moves[0].detail, { from: inbox, to: doing });
      assert.equal(thread.json.events.filter((e) => e.kind === "status").length, 1, JSON.stringify(thread.json.events));
    } finally {
      proxy.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
