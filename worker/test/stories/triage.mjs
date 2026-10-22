import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const HOST = "triage.example";
const ADA = { email: "ada.triage@example.com", name: "Ada Lovelace" };
const GRACE = { email: "grace.triage@example.com", name: "Grace Hopper" };
const MANY = 520;
const ADA_REPORTER = { ...ADA, agent: false };
const GRACE_AUTHOR = { ...GRACE, agent: false, manager: true };

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
    board: () => call("GET", `/_p99/v1/board?host=${HOST}`, { actor }),
    rename: (id, name) => call("PATCH", `/_p99/v1/labels/${id}`, { actor, body: { name } }),
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
  const labelEvents = (thread) => thread.events.filter((e) => e.kind === "label");

  const put = await call("PUT", `/_p99/v1/hosts/${HOST}`, { body: { env: "production", config: {} } });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  const lanes = (await ada.board()).json.board.lanes;
  assert.equal(lanes.length, 7, JSON.stringify(lanes));
  const [inbox, doing, review, done] = [lanes[0], lanes[2], lanes[5], lanes[6]].map((l) => l.label);
  assert.equal(lanes[6].closes, true, JSON.stringify(lanes));
  const laneIds = (await call("GET", "/_p99/v1/labels", { actor: ADA })).json.labels.map((l) => l.id);

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
      assert.equal(answer.json.total, cursor ? undefined : MANY, "only the first page counts every match");
      cursor = answer.json.next_cursor;
      if (!cursor) break;
    }
    assert.equal(seen.length, MANY);
    const one = await ada.list(`q=many%20card%20${MANY}`);
    assert.deepEqual([one.json.total, keysOf(one).length], [1, 1], "a single page counts what it holds");
    const none = await ada.list("q=zzz-no-such-card");
    assert.equal(none.json.total, 0);
    assert.equal(new Set(seen).size, MANY, "an item showed on two pages");
    const ids = seen.map((k) => Number(k.split("-")[1]));
    assert.deepEqual(ids, [...ids].sort((a, b) => b - a));

    const ours = new Set(seen);
    const lane = async () => {
      const page = await ada.board();
      assert.equal(page.status, 200, JSON.stringify(page.json));
      return page.json.cards.filter((c) => c.label === doing && ours.has(c.key)).map((c) => c.key);
    };
    const parked = [];
    for (const key of seen.slice(0, 12)) {
      const moved = await ada.move({ key, from: inbox, to: doing, after: parked.at(-1) });
      assert.equal(moved.status, 200, JSON.stringify(moved.json));
      parked.push(key);
    }
    assert.deepEqual(await lane(), parked);
    const all = (await ada.board()).json.cards;
    assert.ok(all.length >= MANY, `the board shows ${all.length} cards`);
    assert.equal(new Set(all.map((c) => c.key)).size, all.length);
    const middle = seen[300];
    const placed = await ada.move({ key: middle, from: inbox, to: doing, after: parked[5] });
    assert.equal(placed.status, 200, JSON.stringify(placed.json));
    assert.deepEqual(await lane(), [...parked.slice(0, 6), middle, ...parked.slice(6)]);
    const inboxLane = (await ada.board()).json.cards.filter((c) => c.label === inbox).map((c) => c.key);
    const tail = seen.slice(12).filter((k) => k !== middle);
    const wanted = inboxLane.filter((k) => tail.includes(k));
    assert.deepEqual(wanted, tail, "the cards left in the inbox lost their order");
    const between = await ada.move({ key: seen[400], from: inbox, to: inbox, before: tail[0] });
    assert.equal(between.status, 200, JSON.stringify(between.json));
    const reordered = (await ada.board()).json.cards.filter((c) => c.label === inbox).map((c) => c.key);
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
        const cards = (await who.board()).json.cards.filter((c) => c.key === key);
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

  await check("triage: a label filter finds a label whatever its case, accents included, as a move does", async () => {
    try {
      const accents = await ada.rename(laneIds[1], "Évalué");
      assert.equal(accents.status, 200, JSON.stringify(accents.json));
      const key = await filed(ada, { title: "Judged" });
      assert.equal((await ada.move({ key, from: inbox, to: "évalué" })).status, 200);
      assert.deepEqual(keysOf(await ada.list(`label=${encodeURIComponent("Évalué")}`)), [key]);
      assert.deepEqual(keysOf(await ada.list(`label=${encodeURIComponent("évalué")}`)), [key]);
      assert.deepEqual(keysOf(await ada.list(`label=${encodeURIComponent("EVALUE")}`)), [key]);
      assert.deepEqual(keysOf(await ada.list(`label=${encodeURIComponent("  évalué ")}`)), [key]);
      assert.deepEqual(keysOf(await ada.list(`label=${encodeURIComponent("Évaluée")}`)), []);
      assert.equal((await ada.move({ key, from: "ÉVALUÉ", to: inbox })).status, 200);
      assert.deepEqual(keysOf(await ada.list(`label=${encodeURIComponent("Évalué")}`)), []);
    } finally {
      await ada.rename(laneIds[1], lanes[1].label);
    }
  });

  await check("triage: a filter or a move by a lane's name in another case with a dotted capital or a diaeresis finds that lane", async () => {
    assert.ok(/i/i.test(doing) && /e/i.test(review), JSON.stringify([doing, review]));
    const shouted = doing.toUpperCase().replace(/I/g, "İ");
    const marked = review.toLowerCase().replace(/e/g, "ë");
    const key = await filed(ada, { title: "Dotted capitals" });
    assert.equal((await ada.move({ key, from: inbox, to: shouted })).status, 200);
    const byShout = keysOf(await ada.list(`label=${encodeURIComponent(shouted)}`));
    assert.ok(byShout.includes(key), JSON.stringify(byShout));
    assert.deepEqual(byShout, keysOf(await ada.list(`label=${encodeURIComponent(doing)}`)));
    assert.equal((await ada.move({ key, from: shouted.toLowerCase(), to: marked })).status, 200);
    assert.ok(keysOf(await ada.list(`label=${encodeURIComponent(marked)}`)).includes(key));
    assert.ok(!keysOf(await ada.list(`label=${encodeURIComponent(shouted)}`)).includes(key));
  });

  await check("triage: a search for a whole sentence, up to the 200 characters q takes, answers with results, never a 500", async () => {
    const title = "Pay stays grey after the card is accepted on the checkout page";
    const key = await filed(ada, { title });
    const answer = await ada.list(`q=${encodeURIComponent(title)}`);
    assert.equal(answer.status, 200, JSON.stringify(answer.json));
    assert.deepEqual(keysOf(answer), [key]);
    assert.deepEqual(keysOf(await ada.list(`q=${"x".repeat(200)}`)), []);
  });

  await check("triage: a search of 1, 49, 50, 51 or 200 characters, multibyte or with % _ and \\, finds its item; 201 characters is refused plainly", async () => {
    const sentence =
      "ʬ Grüße aus Zürich: the 🚀 total jumps from 10% to 100% when the snake_case field holds a back\\slash, " +
      "שָׁלוֹם and زرّ show beside it, and Ada Lovelace waits for the receipt mail that Grace Hopper sent from the checkout page";
    const points = [...sentence];
    assert.ok(points.length >= 201, String(points.length));
    const key = await filed(ada, { title: "Long search", body: sentence });
    const found = async (q) => keysOf(await ada.list(`q=${encodeURIComponent(q)}`));
    assert.ok(new TextEncoder().encode(points.slice(0, 49).join("")).length > 50);
    for (const n of [1, 49, 50, 51, 200]) {
      const q = points.slice(0, n).join("");
      assert.deepEqual(await found(q), [key], `${n} characters`);
    }
    const tail = points.slice(points.length - 120).join("");
    assert.deepEqual(await found(tail.toUpperCase()), [key]);
    assert.deepEqual(await found(points.slice(10, 80).join("")), [key]);
    assert.deepEqual(await found(points.slice(0, 80).join("").replace("snake_case", "snakeXcase")), []);
    assert.deepEqual(await found(points.slice(0, 80).join("").replace("10% to", "10X to")), []);
    assert.deepEqual(await found(points.slice(0, 80).join("").replace("snake_case", "snake%case")), []);
    assert.deepEqual(await found("GRUßE AUS ZURICH: THE"), [key]);
    assert.deepEqual(await found("%".repeat(60)), []);
    assert.deepEqual(await found("_".repeat(60)), []);
    assert.deepEqual(await found("🚀".repeat(200)), []);
    for (const q of ["x".repeat(201), "🚀".repeat(201), `${points.slice(0, 200).join("")}z`]) {
      const refused = await ada.list(`q=${encodeURIComponent(q)}`);
      assert.equal(refused.status, 400, JSON.stringify(refused.json));
      assert.match(JSON.stringify(refused.json), /q must be at most 200 characters/);
    }
    assert.deepEqual(await found(`  ${points.slice(0, 200).join("")}  `), [key]);
  });

  await check("triage: a 200-character title is taken whatever its script, emoji included; 201 is refused", async () => {
    const emoji = "🚀".repeat(200);
    const made = await ada.file({ title: emoji });
    assert.equal(made.status, 201, `200 emoji were refused: ${JSON.stringify(made.json)}`);
    assert.equal((await ada.get(made.json.key)).json.issue.title, emoji);
    const script = await ada.file({ title: "𝒜".repeat(200) });
    assert.equal(script.status, 201, JSON.stringify(script.json));
    for (const title of ["🚀".repeat(201), "a".repeat(201), `${"🚀".repeat(200)}a`]) {
      const refused = await ada.file({ title });
      assert.equal(refused.status, 400, JSON.stringify(refused.json));
      assert.match(JSON.stringify(refused.json), /title must be 1 to 200 characters/);
    }
    const key = await filed(ada, { title: "Renamed to emoji" });
    assert.equal((await ada.patch(key, { title: "🎉".repeat(200) })).status, 200);
    assert.equal((await ada.patch(key, { title: "🎉".repeat(201) })).status, 400);
  });

  await check("triage: a body or a comment of 20,000 emoji is taken and one character more is refused, on filing, editing, commenting and importing", async () => {
    const full = "🚀".repeat(20000);
    const over = [`${full}a`, "🚀".repeat(20001), "a".repeat(20001)];
    const made = await ada.file({ title: "Long body", body: full });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    assert.equal((await ada.get(made.json.key)).json.issue.body, full);
    for (const body of over) {
      const refused = await ada.file({ title: "Too long a body", body });
      assert.equal(refused.status, 400, JSON.stringify(refused.json));
      assert.match(JSON.stringify(refused.json), /body must be at most 20000 characters/);
    }
    const key = made.json.key;
    assert.equal((await ada.patch(key, { body: "🎉".repeat(20000) })).status, 200);
    assert.equal((await ada.get(key)).json.issue.body, "🎉".repeat(20000));
    for (const body of over) assert.equal((await ada.patch(key, { body })).status, 400);
    assert.equal((await ada.get(key)).json.issue.body, "🎉".repeat(20000));
    let n = 0;
    const comment = (body) => call("POST", `/_p99/v1/issues/${key}/comments?host=${HOST}`, { actor: ADA, body: { client_uid: `long-comment-${++n}`, body } });
    const said = await comment(full);
    assert.equal(said.status, 201, JSON.stringify(said.json));
    assert.equal(said.json.body, full);
    for (const body of [...over, "   ", "\n\t "]) {
      const refused = await comment(body);
      assert.equal(refused.status, 400, JSON.stringify(refused.json));
      assert.match(JSON.stringify(refused.json), /body must be 1 to 20000 characters/);
    }
    const record = (body) => [
      {
        type: "item",
        key: "BUG-9901",
        kind: "bug",
        title: "Imported with a long body",
        body,
        status: "confirmed",
        duplicate_of: null,
        reporter: ADA_REPORTER,
        assignee: null,
        env: null,
        page: { url: `https://${HOST}/checkout`, path: "/checkout", title: "Checkout" },
        context: {},
        marks: [],
        created_at: "2025-03-01T10:00:00Z",
        updated_at: "2025-03-02T10:00:00Z",
        closed_at: null,
      },
      { type: "comment", item: "BUG-9901", uid: "long-import-comment", author: GRACE_AUTHOR, body, internal: false, created_at: "2025-03-02T09:00:00Z" },
    ];
    const dry = (records) => call("POST", `/_p99/v1/import?host=${HOST}&dry_run=1`, { body: records });
    const taken = await dry(record(full));
    assert.equal(taken.status, 200, JSON.stringify(taken.json));
    const [item, note] = record(full);
    for (const body of over) {
      const long = await dry([{ ...item, body }, note]);
      assert.equal(long.status, 400, JSON.stringify(long.json));
      assert.match(JSON.stringify(long.json), /record 1 \(item\): body must be at most 20000 characters/);
      const said = await dry([item, { ...note, body }]);
      assert.equal(said.status, 400, JSON.stringify(said.json));
      assert.match(JSON.stringify(said.json), /record 2 \(comment\): body must be 1 to 20000 characters/);
    }
    const blank = await dry([item, { ...note, body: "  " }]);
    assert.equal(blank.status, 400, JSON.stringify(blank.json));
  });

  await check("triage: two lanes whose names fold alike stay apart: an exact name wins, and a card moved between them answers 409", async () => {
    try {
      assert.equal((await ada.rename(laneIds[1], "Révisé")).status, 200);
      assert.equal((await ada.rename(laneIds[4], "revise")).status, 200);
      const key = await filed(ada, { title: "Between twins" });
      assert.equal((await ada.move({ key, from: inbox, to: "revise" })).status, 200);
      assert.equal((await ada.get(key)).json.issue.label, "revise");
      assert.deepEqual(keysOf(await ada.list("label=revise")), [key]);
      assert.deepEqual(keysOf(await ada.list("label=REVISE")), [key]);
      assert.deepEqual(keysOf(await ada.list(`label=${encodeURIComponent("Révisé")}`)), []);
      assert.equal((await ada.move({ key, from: "Revise", to: "Révisé" })).status, 200);
      assert.equal((await ada.get(key)).json.issue.label, "Révisé");
      assert.deepEqual(keysOf(await ada.list(`label=${encodeURIComponent("Révisé")}`)), [key]);
      assert.deepEqual(keysOf(await ada.list("label=revise")), []);
      const stale = await ada.move({ key, from: "revise", to: done });
      assert.equal(stale.status, 409, JSON.stringify(stale.json));
      assert.equal((await ada.get(key)).json.issue.label, "Révisé");
      assert.equal((await ada.move({ key, from: "RÉVISÉ", to: "revise" })).status, 200);
      assert.equal((await ada.get(key)).json.issue.label, "revise");
      for (const move of [{ key, from: "revise", to: "RÉVISÉ" }, { key, from: "revise", to: "RÉVISÉ", board: 1 }]) {
        const both = await ada.move(move);
        assert.equal(both.status, 400, JSON.stringify(both.json));
        assert.match(both.json.message, /RÉVISÉ names more than one lane; give its exact name/);
        assert.equal((await ada.get(key)).json.issue.label, "revise");
      }
    } finally {
      await ada.rename(laneIds[1], lanes[1].label);
      await ada.rename(laneIds[4], lanes[4].label);
    }
  });
}
