import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const HOST = "triage.example";
const ADA = { email: "ada.triage@example.com", name: "Ada Lovelace" };
const GRACE = { email: "grace.triage@example.com", name: "Grace Hopper" };
const MANY = 520;

export async function triageStories({ call, browse, mint, check, red, issueBody, here, listen, wrangler, state, root }) {
  const d1 = (command) => {
    const run = spawnSync(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", state, "--json", "--command", command], {
      cwd: root,
      env: { ...process.env, CI: "1" },
      encoding: "utf8",
    });
    if (run.status !== 0) throw new Error(`d1 ${command} failed:\n${run.stdout}\n${run.stderr}`);
    return JSON.parse(run.stdout)[0].results;
  };
  const session = (actor) => ({
    file: (overrides = {}) =>
      call("POST", `/_p99/v1/issues?host=${HOST}`, {
        actor,
        body: issueBody({ page: { url: `https://${HOST}/checkout`, path: "/checkout", title: "Checkout" }, ...overrides }),
      }),
    get: (key) => call("GET", `/_p99/v1/issues/${key}?host=${HOST}`, { actor }),
    patch: (key, body) => call("PATCH", `/_p99/v1/issues/${key}?host=${HOST}`, { actor, body }),
    move: (body) => call("POST", `/_p99/v1/move?host=${HOST}`, { actor, body }),
    list: (params = "") => call("GET", `/_p99/v1/issues?scope=all&host=${HOST}&limit=100${params ? `&${params}` : ""}`, { actor }),
    boards: () => call("GET", `/_p99/v1/boards?host=${HOST}`, { actor }),
    board: (id) => call("GET", `/_p99/v1/boards/${id}?host=${HOST}`, { actor }),
  });
  const ada = session(ADA);
  const grace = session(GRACE);
  const filed = async (who, overrides) => {
    const made = await who.file(overrides);
    assert.equal(made.status, 201, JSON.stringify(made.json));
    return made.json.key;
  };
  const keysOf = (answer) => {
    assert.equal(answer.status, 200, JSON.stringify(answer.json));
    return answer.json.issues.map((i) => i.key);
  };
  const ownBoard = async (who) => {
    const listed = await who.boards();
    assert.equal(listed.status, 200, JSON.stringify(listed.json));
    const mine = listed.json.boards.find((b) => b.mine);
    assert.ok(mine, JSON.stringify(listed.json));
    return mine;
  };
  const labelEvents = (thread) => thread.events.filter((e) => e.kind === "label");

  const put = await call("PUT", `/_p99/v1/hosts/${HOST}`, { body: { env: "production", config: {} } });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  const board = await ownBoard(ada);
  await ownBoard(grace);
  assert.equal(board.columns.length, 4, JSON.stringify(board));
  const [inbox, doing, review, done] = board.columns.map((c) => c.label);
  assert.equal(board.columns[3].closes, true, JSON.stringify(board));

  await check("triage: the owner finds an item by any word, without accents, Hebrew or Arabic without their marks, by emoji or by key; % _ and \\ match only themselves; no match is an empty list; an over-long query is refused plainly", async () => {
    const titles = {
      creme: "Crème brûlée page is cold",
      hebrew: "הַכַּפְתּוֹר בדף שָׁלוֹם לא עובד",
      arabic: "زرّ الدَّفْع لا يعمل",
      rocket: "Rocket 🚀 launch button fails",
      percent: "Discount 100% off never applies",
      under: "snake_case field breaks the form",
      slash: "A back\\slash in the path",
    };
    const keys = {};
    for (const [name, title] of Object.entries(titles)) keys[name] = await filed(ada, { title, body: "" });
    const found = async (q) => keysOf(await ada.list(`q=${encodeURIComponent(q)}`));
    assert.deepEqual(await found("CREME BRULEE"), [keys.creme]);
    assert.deepEqual(await found("crème"), [keys.creme]);
    assert.deepEqual(await found("Crème"), [keys.creme]);
    assert.deepEqual(await found("שלום"), [keys.hebrew]);
    assert.deepEqual(await found("الدفع"), [keys.arabic]);
    assert.deepEqual(await found("🚀"), [keys.rocket]);
    assert.deepEqual(await found("100%"), [keys.percent]);
    assert.deepEqual(await found("%"), [keys.percent]);
    assert.deepEqual(await found("_"), [keys.under]);
    assert.deepEqual(await found("\\"), [keys.slash]);
    assert.deepEqual(await found(keys.rocket), [keys.rocket]);
    assert.deepEqual(await found("nothing like this anywhere"), []);
    const long = await ada.list(`q=${"x".repeat(201)}`);
    assert.equal(long.status, 400, JSON.stringify(long.json));
    assert.equal(long.json.message, "q must be at most 200 characters");
  });

  await check("triage: a list keeps to its status, kind and label filters, in any case of the label, and newest first", async () => {
    const question = await filed(ada, { kind: "question", title: "Is shipping free over 50?" });
    const working = await filed(ada, { title: "Working on it" });
    const gone = await filed(ada, { title: "Not worth it" });
    assert.equal((await ada.move({ key: working, from: inbox, to: doing })).status, 200);
    assert.equal((await ada.patch(gone, { resolution: "abandoned" })).status, 200);
    const open = keysOf(await ada.list("status=open"));
    assert.ok(open.includes(question) && open.includes(working) && !open.includes(gone));
    assert.deepEqual(keysOf(await ada.list("status=closed")), [gone]);
    assert.deepEqual(keysOf(await ada.list("kind=question")), [question]);
    assert.deepEqual(keysOf(await ada.list(`label=${encodeURIComponent(doing)}`)), [working]);
    assert.deepEqual(keysOf(await ada.list(`label=${encodeURIComponent(doing.toUpperCase())}`)), [working]);
    const all = keysOf(await ada.list());
    const ids = all.map((k) => Number(k.split("-")[1]));
    assert.deepEqual(ids, [...ids].sort((a, b) => b - a));
    assert.equal((await ada.list("kind=nope")).status, 400);
    assert.equal((await ada.list("status=sideways")).status, 400);
  });

  await check("triage: assign by @username in any case or to me or to no one; a stranger, another host's member, a bad name or a reporter is refused and changes nothing; the history keeps every hand-off", async () => {
    await mint("Hedy Lamarr", "hedy.triage@example.com", [HOST]);
    const joan = await mint("Joan Clarke", "joan.triage@example.com", [here]);
    const usernames = async (host) => (await call("GET", `/_p99/v1/people?host=${host}`, { actor: ADA })).json.people.map((p) => p.username);
    const hedy = (await usernames(HOST)).find((u) => u.startsWith("hedy"));
    const far = (await usernames(here)).find((u) => u.startsWith("joan"));
    assert.ok(hedy && far, "usernames for Hedy and Joan");
    const key = await filed(grace, { title: "Hand me around" });
    const to = async (assignee) => {
      const changed = await ada.patch(key, { assignee });
      assert.equal(changed.status, 200, JSON.stringify(changed.json));
      return changed.json.assignee;
    };
    assert.deepEqual(await to(`@${hedy.toUpperCase()}`), { username: hedy });
    assert.deepEqual((await ada.list()).json.issues.find((i) => i.key === key).assignee, { username: hedy });
    const me = await to("me");
    assert.ok(me && me.username && me.username !== hedy, JSON.stringify(me));
    for (const [assignee, said] of [
      ["nobody.here.at.all", `is not a member of ${HOST}`],
      [far, `is not a member of ${HOST}`],
      ["Not A Name!", "assignee must be a username, me or null"],
    ]) {
      const refused = await ada.patch(key, { assignee });
      assert.equal(refused.status, 400, JSON.stringify(refused.json));
      assert.ok(refused.json.message.includes(said), refused.json.message);
    }
    assert.deepEqual((await ada.get(key)).json.issue.assignee, me);
    assert.equal(await to(null), null);
    const own = await browse("POST", "/issues", joan.secret, issueBody({ title: "Mine to keep" }));
    assert.equal(own.status, 201, JSON.stringify(own.json));
    assert.equal((await browse("PATCH", `/issues/${own.json.key}`, joan.secret, { assignee: "me" })).status, 403);
    const handoffs = (await ada.get(key)).json.events.filter((e) => e.kind === "assignee");
    assert.equal(handoffs.length, 3, JSON.stringify(handoffs));
    assert.deepEqual(handoffs.map((e) => [e.detail.from?.username ?? null, e.detail.to?.username ?? null]), [
      [null, hedy],
      [hedy, me.username],
      [me.username, null],
    ]);
  });

  await check("triage: close as dropped or duplicate and reopen; a duplicate of nothing, of itself or of another host's item is refused and leaves the item open", async () => {
    const key = await filed(grace, { title: "Close and reopen me" });
    const first = await filed(grace, { title: "The first report of it" });
    const elsewhere = (await call("POST", `/_p99/v1/issues?host=${here}`, { body: issueBody({ title: "Somewhere else" }) })).json.key;
    for (const body of [{ resolution: "duplicate" }, { duplicate_of: key }, { duplicate_of: elsewhere }, { resolution: "sideways" }]) {
      const refused = await ada.patch(key, body);
      assert.equal(refused.status, 400, `${JSON.stringify(body)} ${JSON.stringify(refused.json)}`);
    }
    assert.equal((await ada.get(key)).json.issue.stage, "received");
    const dropped = await ada.patch(key, { resolution: "abandoned" });
    assert.deepEqual([dropped.json.stage, dropped.json.resolution, dropped.json.label], ["dropped", "abandoned", done]);
    assert.ok(keysOf(await ada.list("status=closed")).includes(key));
    assert.equal(keysOf(await ada.list("status=open")).includes(key), false);
    const reopened = await ada.patch(key, { resolution: null });
    assert.deepEqual([reopened.json.stage, reopened.json.resolution, reopened.json.label], ["received", null, inbox]);
    const duplicate = await ada.patch(key, { resolution: "duplicate", duplicate_of: first });
    assert.equal(duplicate.status, 200, JSON.stringify(duplicate.json));
    assert.deepEqual([duplicate.json.stage, duplicate.json.duplicate_of], ["duplicate", first]);
    const back = await ada.move({ key, from: done, to: inbox });
    assert.equal(back.status, 200, JSON.stringify(back.json));
    const now = (await ada.get(key)).json.issue;
    assert.deepEqual([now.stage, now.resolution, now.label], ["received", null, inbox]);
  });

  await check("triage: RTL, emoji, ZWJ and combining text comes back exactly as sent; only bidi controls and escapes go; a 20,000-character body and a 200-character title fit, one more is refused", async () => {
    const title = "שלום עולם — زر الدفع — 👩‍💻 Café café";
    const key = await filed(ada, { title, body: "Le panier est vide. السلة فارغة. 🛒" });
    const read = (await ada.get(key)).json.issue;
    assert.equal(read.title, title);
    assert.equal(read.body, "Le panier est vide. السلة فارغة. 🛒");
    assert.ok(keysOf(await ada.list(`q=${encodeURIComponent("עולם")}`)).includes(key));
    const tricked = await filed(ada, { title: "Invoice ‮fdp.exe‬ and \u001b[31mred\u0007", body: "x⁦y⁩z" });
    const clean = (await ada.get(tricked)).json.issue;
    assert.equal(clean.title, "Invoice fdp.exe and [31mred");
    assert.equal(clean.body, "xyz");
    const body = "é".repeat(19990) + "0123456789";
    assert.equal(body.length, 20000);
    const big = await filed(ada, { title: "h".repeat(200), body });
    assert.equal((await ada.get(big)).json.issue.body, body);
    assert.equal((await ada.get(big)).json.issue.title.length, 200);
    const over = await ada.file({ title: "Too long", body: body + "!" });
    assert.equal(over.status, 400, JSON.stringify(over.json));
    const long = await ada.file({ title: "h".repeat(201) });
    assert.equal(long.status, 400, JSON.stringify(long.json));
    const edited = await ada.patch(big, { title: "Paiement refusé — الدفع 💳", body: "שלום" });
    assert.equal(edited.status, 200, JSON.stringify(edited.json));
    assert.deepEqual([edited.json.title, edited.json.body], ["Paiement refusé — الدفع 💳", "שלום"]);
  });

  await check(`triage: ${MANY} items page through once each, newest first, and a board of ${MANY}+ cards keeps every neighbour in place when one moves into the middle`, async () => {
    d1(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${MANY})
      INSERT INTO items (client_uid, kind, label_id, open, title, body, origin_env, page_url, page_path, page_title,
        reporter_email, reporter_name, reporter_json, context_json, marks_json, activity_at, public_activity_at,
        created_at, updated_at, host, reporter_agent, search_text)
      SELECT 'triage-many-' || i, 'bug', (SELECT id FROM labels WHERE role = 'inbox'), 1, 'Many card ' || i, '', 'production',
        'https://${HOST}/', '/', '', 'many@example.com', 'Many', '{}', '{}', '[]', '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '${HOST}', 0, 'many card ' || i
      FROM n;`);
    const seen = [];
    let cursor = null;
    for (let page = 0; page < 20; page++) {
      const answer = await ada.list(`q=many%20card${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...keysOf(answer));
      cursor = answer.json.next_cursor;
      if (!cursor) break;
    }
    assert.equal(seen.length, MANY);
    assert.equal(new Set(seen).size, MANY, "an item showed on two pages");
    const ids = seen.map((k) => Number(k.split("-")[1]));
    assert.deepEqual(ids, [...ids].sort((a, b) => b - a));

    const ours = new Set(seen);
    const lane = async () => {
      const page = await ada.board(board.id);
      assert.equal(page.status, 200, JSON.stringify(page.json));
      return page.json.cards.filter((c) => c.label === doing && ours.has(c.key)).map((c) => c.key);
    };
    const parked = [];
    for (const key of seen.slice(0, 12)) {
      const moved = await ada.move({ key, from: inbox, to: doing, board: board.id, after: parked.at(-1) });
      assert.equal(moved.status, 200, JSON.stringify(moved.json));
      parked.push(key);
    }
    assert.deepEqual(await lane(), parked);
    const all = (await ada.board(board.id)).json.cards;
    assert.ok(all.length >= MANY, `the board shows ${all.length} cards`);
    assert.equal(new Set(all.map((c) => c.key)).size, all.length);
    const middle = seen[300];
    const placed = await ada.move({ key: middle, from: inbox, to: doing, board: board.id, after: parked[5] });
    assert.equal(placed.status, 200, JSON.stringify(placed.json));
    assert.deepEqual(await lane(), [...parked.slice(0, 6), middle, ...parked.slice(6)]);
    const inboxLane = (await ada.board(board.id)).json.cards.filter((c) => c.label === inbox).map((c) => c.key);
    const tail = seen.slice(12).filter((k) => k !== middle);
    const wanted = inboxLane.filter((k) => tail.includes(k));
    assert.deepEqual(wanted, tail, "the cards left in the inbox lost their order");
    const between = await ada.move({ key: seen[400], from: inbox, to: inbox, board: board.id, before: tail[0] });
    assert.equal(between.status, 200, JSON.stringify(between.json));
    const reordered = (await ada.board(board.id)).json.cards.filter((c) => c.label === inbox).map((c) => c.key);
    assert.equal(reordered.indexOf(seen[400]) + 1, reordered.indexOf(tail[0]));
  });

  await check("triage: two sessions moving one card at once make one move; the other gets the 409, both read the same label, the board shows the card once and the history holds one move", async () => {
    const key = await filed(grace, { title: "Fought over" });
    const heard = [];
    const stream = await listen(`/_p99/v1/stream?host=${HOST}`, heard);
    try {
      const [one, two] = await Promise.all([ada.move({ key, from: inbox, to: doing }), grace.move({ key, from: inbox, to: review })]);
      const statuses = [one.status, two.status].sort();
      assert.deepEqual(statuses, [200, 409], `${JSON.stringify(one.json)} ${JSON.stringify(two.json)}`);
      const winner = one.status === 200 ? one : two;
      const loser = one.status === 200 ? two : one;
      assert.deepEqual(loser.json, { error: "moved", message: "this card moved; refreshed" });
      const end = winner.json.card.label;
      assert.equal((await ada.get(key)).json.issue.label, end);
      assert.equal((await grace.get(key)).json.issue.label, end);
      for (const who of [ada, grace]) {
        const own = await ownBoard(who);
        const cards = (await who.board(own.id)).json.cards.filter((c) => c.key === key);
        assert.ok(cards.length <= 1, JSON.stringify(cards));
        if (cards.length === 1) assert.equal(cards[0].label, end);
      }
      assert.equal(labelEvents((await ada.get(key)).json).length, 1);
      for (let i = 0; i < 50 && !heard.some((e) => e.key === key && e.type === "label"); i++) await new Promise((r) => setTimeout(r, 100));
      const pushed = heard.filter((e) => e.key === key && e.type === "label");
      assert.equal(pushed.length, 1, JSON.stringify(heard));
      assert.equal(pushed[0].to, end);
      const retry = await (loser === one ? ada : grace).move({ key, from: end, to: inbox });
      assert.equal(retry.status, 200, JSON.stringify(retry.json));
    } finally {
      stream.close();
    }
  });

  await check("triage: edits of one field by two sessions are last write wins, and the history keeps both, old and new", async () => {
    const key = await filed(grace, { title: "First words" });
    assert.equal((await ada.patch(key, { title: "Ada's words" })).status, 200);
    assert.equal((await grace.patch(key, { title: "Grace's words" })).status, 200);
    const thread = (await ada.get(key)).json;
    assert.equal(thread.issue.title, "Grace's words");
    assert.equal((await grace.get(key)).json.issue.title, "Grace's words");
    const titles = thread.events.filter((e) => e.kind === "title").map((e) => [e.detail.from, e.detail.to]);
    assert.deepEqual(titles, [
      ["First words", "Ada's words"],
      ["Ada's words", "Grace's words"],
    ]);
  });

  await red("triage: a label filter finds a label whatever its case, accents included, as a move does", "a list filtered by an accented label in another case finds nothing, though a move to it works", async () => {
    const accents = await call("POST", `/_p99/v1/boards?host=${HOST}`, {
      actor: ADA,
      body: { name: "Accents", columns: [inbox, "Évalué", done] },
    });
    assert.equal(accents.status, 201, JSON.stringify(accents.json));
    const key = await filed(ada, { title: "Judged" });
    assert.equal((await ada.move({ key, from: inbox, to: "évalué", board: accents.json.id })).status, 200);
    assert.deepEqual(keysOf(await ada.list(`label=${encodeURIComponent("Évalué")}`)), [key]);
    assert.deepEqual(keysOf(await ada.list(`label=${encodeURIComponent("évalué")}`)), [key]);
  });

  await red("triage: a search for a whole sentence, up to the 200 characters q takes, answers with results, never a 500", "a search over about 48 characters answers 500: D1 refuses a LIKE pattern over 50 bytes", async () => {
    const title = "Pay stays grey after the card is accepted on the checkout page";
    const key = await filed(ada, { title });
    const answer = await ada.list(`q=${encodeURIComponent(title)}`);
    assert.equal(answer.status, 200, JSON.stringify(answer.json));
    assert.deepEqual(keysOf(answer), [key]);
    assert.deepEqual(keysOf(await ada.list(`q=${"x".repeat(200)}`)), []);
  });

  await red("triage: a 200-character title is taken whatever its script, emoji included", "a title of 200 emoji is refused as too long", async () => {
    const emoji = "🚀".repeat(200);
    const made = await ada.file({ title: emoji });
    assert.equal(made.status, 201, `200 emoji were refused: ${JSON.stringify(made.json)}`);
    assert.equal((await ada.get(made.json.key)).json.issue.title, emoji);
  });
}
