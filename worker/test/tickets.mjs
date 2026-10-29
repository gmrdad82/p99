import assert from "node:assert/strict";
import { RESCOPED, closeRescoped, codeScope, fanOut, liveCodes, liveSockets, publisher, redeemTicket, storeTicket } from "../src/boards.js";

const SPACE = JSON.stringify({ space: true });

function fakeDB({ live = [], broken = false, grants = {}, hosts = [] } = {}) {
  const queries = [];
  return {
    queries,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async all() {
              queries.push({ sql, args });
              if (broken) throw new Error("D1_ERROR: the database is unavailable");
              if (/FROM codes k WHERE k\.id IN/.test(sql)) {
                const wanted = JSON.parse(args[0]).filter((id) => live.includes(id));
                return { results: wanted.map((id) => ({ id, grant_json: grants[id] ?? SPACE, hosts_json: "[]", hosts: JSON.stringify(hosts) })) };
              }
              const wanted = JSON.parse(args[0]);
              return { results: wanted.filter((id) => live.includes(id)).map((id) => ({ id })) };
            },
          };
        },
      };
    },
  };
}

function fakeStorage() {
  const map = new Map();
  return {
    map,
    async get(key) {
      return map.get(key);
    },
    async put(key, value) {
      map.set(key, value);
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) map.delete(key);
    },
    async list({ prefix, limit }) {
      return new Map([...map].filter(([key]) => key.startsWith(prefix)).slice(0, limit));
    },
  };
}

function fakeSocket(attachment) {
  return {
    attachment,
    sent: [],
    closed: null,
    send(line) {
      if (this.closed) throw new Error("the socket is closed");
      this.sent.push(JSON.parse(line));
    },
    close(code, reason) {
      this.closed = { code, reason };
    },
  };
}

function pairs(...sockets) {
  return sockets.map((socket) => [socket, socket.attachment]);
}

function ticketUrl(hash, origin = "example.com") {
  return new URL(`https://hub.p99/connect?ticket=${hash}&origin=${origin}`);
}

const silent = (fn) => async () => {
  const error = console.error;
  console.error = () => {};
  try {
    await fn();
  } finally {
    console.error = error;
  }
};

export async function ticketChecks({ check }) {
  await check("[tickets] liveCodes asks once for the distinct real ids and nothing for an empty list", async () => {
    const DB = fakeDB({ live: [3] });
    const live = await liveCodes(DB, [null, undefined, 3, 3, 4]);
    assert.deepEqual([...live], [3]);
    assert.equal(DB.queries.length, 1);
    assert.deepEqual(JSON.parse(DB.queries[0].args[0]), [3, 4]);
    assert.match(DB.queries[0].sql, /revoked_at IS NULL/);
    const none = await liveCodes(DB, [null, undefined]);
    assert.equal(none.size, 0);
    assert.equal(DB.queries.length, 1, "an empty list still queried D1");
  });

  await check("[tickets] liveCodes reports a D1 error as unknown, never as an empty live set", silent(async () => {
    assert.equal(await liveCodes(fakeDB({ broken: true }), [3]), null);
  }));

  await check("[tickets] a live code's ticket opens once, with its code's current reach", async () => {
    const storage = fakeStorage();
    await storeTicket(storage, "a1", { hosts: ["example.com"], code: 7, until: Date.now() + 60000 });
    const DB = fakeDB({ live: [7] });
    assert.deepEqual(await redeemTicket(storage, ticketUrl("a1"), DB), { hosts: null, projects: null, code: 7 });
    assert.equal(await redeemTicket(storage, ticketUrl("a1"), DB), null, "a ticket opened twice");
  });

  await check("[tickets] a ticket opens with the code's grant at redeem time, never the scope stored at issue", async () => {
    const storage = fakeStorage();
    const hosts = [
      { host: "example.com", project_id: 2 },
      { host: "shop.example.com", project_id: 3 },
    ];
    const until = Date.now() + 60000;
    await storeTicket(storage, "h1", { hosts: null, projects: null, code: 7, until });
    const narrowed = fakeDB({ live: [7], grants: { 7: JSON.stringify({ projects: [3] }) }, hosts });
    assert.equal(await redeemTicket(storage, ticketUrl("h1"), narrowed), null, "a ticket issued before a narrower grant opened its old host");
    await storeTicket(storage, "h2", { hosts: ["example.com"], projects: [2], code: 7, until });
    assert.deepEqual(await redeemTicket(storage, ticketUrl("h2", "shop.example.com"), narrowed), { hosts: ["shop.example.com"], projects: [3], code: 7 });
    await storeTicket(storage, "h3", { hosts: ["example.com"], projects: [2], code: 7, until });
    const moved = fakeDB({ live: [7], grants: { 7: JSON.stringify({ projects: [2] }) }, hosts: [{ host: "example.com", project_id: 3 }, { host: "shop.example.com", project_id: 2 }] });
    assert.equal(await redeemTicket(storage, ticketUrl("h3"), moved), null, "a ticket kept a host that moved out of its projects");
    await storeTicket(storage, "h4", { hosts: ["example.com"], projects: [2], code: 7, until });
    const parkedCode = fakeDB({ live: [7], grants: { 7: JSON.stringify({ projects: [] }) }, hosts });
    assert.equal(await redeemTicket(storage, ticketUrl("h4"), parkedCode), null, "a parked code's ticket opened");
    await storeTicket(storage, "h5", { hosts: ["example.com"], projects: [2], code: 7, until });
    assert.deepEqual(await redeemTicket(storage, ticketUrl("h5", "shop.example.com"), fakeDB({ live: [7], hosts })), { hosts: null, projects: null, code: 7 });
    assert.deepEqual(await codeScope(fakeDB({ live: [7], grants: { 7: JSON.stringify({ projects: [2, 3] }) }, hosts }), [7]), { hosts: ["example.com", "shop.example.com"], projects: [2, 3] });
  });

  await check("[tickets] a ticket from several combined codes opens with all their current reach, and nothing once one is revoked", async () => {
    const storage = fakeStorage();
    const hosts = [
      { host: "example.com", project_id: 2 },
      { host: "shop.example.com", project_id: 3 },
    ];
    const grants = { 7: JSON.stringify({ projects: [2] }), 8: JSON.stringify({ projects: [3, 4] }) };
    const until = Date.now() + 60000;
    await storeTicket(storage, "k1", { hosts: ["example.com"], projects: [2], code: 7, codes: [7, 8], until });
    assert.deepEqual(await redeemTicket(storage, ticketUrl("k1", "shop.example.com"), fakeDB({ live: [7, 8], grants, hosts })), {
      hosts: ["example.com", "shop.example.com"],
      projects: [2, 3, 4],
      code: 7,
      codes: [7, 8],
    });
    await storeTicket(storage, "k2", { hosts: null, projects: null, code: 7, codes: [7, 8], until });
    assert.equal(await redeemTicket(storage, ticketUrl("k2"), fakeDB({ live: [7], grants, hosts })), null);
    const combined = fakeSocket({ hosts: ["example.com"], projects: [2, 3], code: 7, codes: [7, 8] });
    const single = fakeSocket({ hosts: ["example.com"], projects: [2], code: 7 });
    const kept = await liveSockets(fakeDB({ live: [7] }), pairs(combined, single));
    assert.deepEqual(kept.map(([socket]) => socket), [single]);
    assert.equal(combined.closed?.code, 4001);
    const again = fakeSocket({ hosts: ["example.com"], projects: [2, 3], code: 7, codes: [7, 8] });
    assert.deepEqual(closeRescoped(pairs(again), 8), []);
    assert.equal(again.closed?.code, 4003);
  });

  await check("[tickets] a revoked code's ticket opens nothing and is spent", async () => {
    const storage = fakeStorage();
    await storeTicket(storage, "b2", { hosts: null, code: 8, until: Date.now() + 60000 });
    assert.equal(await redeemTicket(storage, ticketUrl("b2"), fakeDB({ live: [] })), null);
    assert.equal(storage.map.has("ticket:b2"), false, "a refused ticket stayed for a retry");
    assert.equal(await redeemTicket(storage, ticketUrl("b2"), fakeDB({ live: [8] })), null);
  });

  await check("[tickets] a D1 error at redeem fails closed", silent(async () => {
    const storage = fakeStorage();
    await storeTicket(storage, "c3", { hosts: null, code: 9, until: Date.now() + 60000 });
    assert.equal(await redeemTicket(storage, ticketUrl("c3"), fakeDB({ broken: true })), null);
  }));

  await check("[tickets] a key ticket and a legacy ticket with no code open without asking D1", async () => {
    const storage = fakeStorage();
    await storeTicket(storage, "d4", { hosts: null, code: null, until: Date.now() + 60000 });
    await storeTicket(storage, "e5", { hosts: ["example.com"], until: Date.now() + 60000 });
    const DB = fakeDB({ broken: true });
    assert.deepEqual(await redeemTicket(storage, ticketUrl("d4"), DB), { hosts: null, projects: null, code: null });
    assert.deepEqual(await redeemTicket(storage, ticketUrl("e5"), DB), { hosts: ["example.com"], projects: null, code: null });
    assert.equal(DB.queries.length, 0);
  });

  await check("[tickets] an expired, unknown or other-host ticket opens nothing", async () => {
    const storage = fakeStorage();
    const DB = fakeDB({ live: [1], grants: { 1: JSON.stringify({ projects: [2] }) }, hosts: [{ host: "example.com", project_id: 2 }, { host: "shop.example.com", project_id: 3 }] });
    await storeTicket(storage, "f6", { hosts: null, code: 1, until: Date.now() - 1 });
    await storeTicket(storage, "g7", { hosts: ["example.com"], code: 1, until: Date.now() + 60000 });
    assert.equal(await redeemTicket(storage, ticketUrl("f6"), DB), null);
    assert.equal(await redeemTicket(storage, ticketUrl("nope"), DB), null);
    assert.equal(await redeemTicket(storage, ticketUrl("g7", "shop.example.com"), DB), null);
    assert.equal(storage.map.size, 0);
  });

  await check("[tickets] liveSockets closes only revoked codes' sockets with 4001", async () => {
    const revoked = fakeSocket({ hosts: null, code: 2 });
    const live = fakeSocket({ hosts: null, code: 3 });
    const key = fakeSocket({ hosts: ["example.com"], projects: null, code: null });
    const legacy = fakeSocket({ host: "example.com" });
    const kept = await liveSockets(fakeDB({ live: [3] }), pairs(revoked, live, key, legacy));
    assert.deepEqual(kept.map(([socket]) => socket), [live, key, legacy]);
    assert.deepEqual(revoked.closed, { code: 4001, reason: "this code was revoked" });
    assert.equal(live.closed, null);
    assert.equal(key.closed, null);
    assert.equal(legacy.closed, null);
  });

  await check("[tickets] on a D1 error liveSockets holds code sockets back without closing them", silent(async () => {
    const board = fakeSocket({ hosts: null, code: 3 });
    const key = fakeSocket({ hosts: null, projects: null, code: null });
    const kept = await liveSockets(fakeDB({ broken: true }), pairs(board, key));
    assert.deepEqual(kept.map(([socket]) => socket), [key]);
    assert.equal(board.closed, null, "a D1 error closed a board as revoked");
  }));

  await check("[tickets] a publish never reaches a revoked code's socket even without a revoke call", async () => {
    const revoked = fakeSocket({ hosts: null, code: 2 });
    const live = fakeSocket({ hosts: null, code: 3 });
    const key = fakeSocket({ hosts: ["example.com"], projects: null, code: null });
    await fanOut(fakeDB({ live: [3] }), pairs(revoked, live, key), [{ type: "item", host: "example.com", key: "P-1" }]);
    assert.deepEqual(revoked.sent, []);
    assert.equal(revoked.closed?.code, 4001);
    assert.deepEqual(live.sent, [{ type: "item", host: "example.com", key: "P-1" }]);
    assert.deepEqual(key.sent, [{ type: "item", host: "example.com", key: "P-1" }]);
  });

  await check("[tickets] a publish during a D1 error reaches key streams only, and keeps boards open", silent(async () => {
    const board = fakeSocket({ hosts: null, code: 3 });
    const key = fakeSocket({ hosts: null, projects: null, code: null });
    await fanOut(fakeDB({ broken: true }), pairs(board, key), [{ type: "item", host: "example.com", key: "P-2" }]);
    assert.deepEqual(board.sent, []);
    assert.equal(board.closed, null);
    assert.equal(key.sent.length, 1);
  }));

  await check("[tickets] a publish keeps each socket to its hosts and sends unhosted labels to all", async () => {
    const here = fakeSocket({ hosts: ["example.com"], projects: null, code: null });
    const there = fakeSocket({ hosts: ["shop.example.com"], code: null });
    const all = fakeSocket({ hosts: null, projects: null, code: null });
    await fanOut(fakeDB(), pairs(here, there, all), [
      { type: "item", host: "example.com", key: "P-3" },
      { type: "item", hosts: ["shop.example.com"], key: "P-4" },
      { type: "labels" },
    ]);
    assert.deepEqual(here.sent.map((e) => e.key ?? e.type), ["P-3", "labels"]);
    assert.deepEqual(there.sent.map((e) => e.key ?? e.type), ["P-4", "labels"]);
    assert.deepEqual(all.sent.map((e) => e.key ?? e.type), ["P-3", "P-4", "labels"]);
    assert.equal(all.sent[1].hosts, undefined, "the hosts list leaked into the event");
  });

  await check("[tickets] a project grant's socket hears its projects' events and its hosts' projectless events, never another project's even on its host, and never the projects list", async () => {
    const granted = fakeSocket({ hosts: ["example.com"], projects: [2], code: null });
    const all = fakeSocket({ hosts: null, projects: null, code: null });
    await fanOut(fakeDB(), pairs(granted, all), [
      { type: "item", host: null, projects: [2], key: "P-5" },
      { type: "item", host: "example.com", projects: [9], key: "P-6" },
      { type: "item", host: "shop.example.com", projects: [9], key: "P-7" },
      { type: "item", host: null, projects: [], key: "P-8" },
      { type: "item", host: "example.com", projects: [], key: "P-9" },
      { type: "order", host: "example.com", projects: [2], key: "P-10" },
      { type: "labels" },
    ]);
    assert.deepEqual(granted.sent.map((e) => e.key ?? e.type), ["P-5", "P-9", "P-10", "labels"]);
    assert.deepEqual(all.sent.map((e) => e.key ?? e.type), ["P-5", "P-6", "P-7", "P-8", "P-9", "P-10", "labels"]);
    assert.ok(all.sent.every((e) => e.projects === undefined), "the projects list leaked into the event");
  });

  await check("[tickets] a grant change closes that code's sockets, and a host move closes every project-scoped socket, so each reconnects with a new ticket", async () => {
    const changed = fakeSocket({ hosts: ["example.com"], projects: [2], code: 7 });
    const wholeChanged = fakeSocket({ hosts: null, projects: null, code: 7 });
    const other = fakeSocket({ hosts: ["example.com"], projects: [2], code: 8 });
    const whole = fakeSocket({ hosts: null, projects: null, code: 9 });
    const key = fakeSocket({ hosts: null, projects: null, code: null });
    const kept = closeRescoped(pairs(changed, wholeChanged, other, whole, key), 7);
    assert.deepEqual(kept.map(([socket]) => socket), [other, whole, key]);
    assert.deepEqual(changed.closed, { code: 4003, reason: RESCOPED });
    assert.deepEqual(wholeChanged.closed, { code: 4003, reason: RESCOPED });
    assert.equal(other.closed, null);
    const moved = closeRescoped(pairs(other, whole, key));
    assert.deepEqual(moved.map(([socket]) => socket), [whole, key]);
    assert.deepEqual(other.closed, { code: 4003, reason: RESCOPED });
    assert.equal(whole.closed, null);
    assert.equal(key.closed, null);
  });

  await check("[tickets] publishes reach every socket in call order even when the first one's D1 read answers last", async () => {
    const DB = fakeDB({ live: [3] });
    const all = DB.prepare;
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    let calls = 0;
    DB.prepare = (sql) => {
      const statement = all(sql);
      return {
        bind(...args) {
          const bound = statement.bind(...args);
          return {
            async all() {
              if (calls++ === 0) await held;
              return bound.all();
            },
          };
        },
      };
    };
    const board = fakeSocket({ hosts: null, code: 3 });
    const peer = fakeSocket({ hosts: null, code: 3 });
    const publish = publisher(DB, () => pairs(board, peer));
    const first = publish([{ type: "order", host: "example.com", key: "P-5", to: "B" }]);
    const second = publish([{ type: "order", host: "example.com", key: "P-5", to: "C" }]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(board.sent, [], "the second batch went out while the first one's read was pending");
    release();
    await Promise.all([first, second]);
    assert.deepEqual(board.sent.map((e) => e.to), ["B", "C"]);
    assert.deepEqual(peer.sent.map((e) => e.to), ["B", "C"]);
  });

  await check("[tickets] a publish that fails never stalls the ones after it", async () => {
    const key = fakeSocket({ hosts: null, projects: null, code: null });
    let broken = true;
    const publish = publisher(fakeDB(), () => {
      if (broken) {
        broken = false;
        throw new Error("the hub lost its sockets");
      }
      return pairs(key);
    });
    await assert.rejects(publish([{ type: "item", host: "example.com", key: "P-6" }]), /lost its sockets/);
    await publish([{ type: "item", host: "example.com", key: "P-7" }]);
    assert.deepEqual(key.sent.map((e) => e.key), ["P-7"]);
  });
}
