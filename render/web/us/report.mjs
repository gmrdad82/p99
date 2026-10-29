import assert from "node:assert/strict";
import {
  FAILED,
  GRACE,
  RETRY,
  RUN,
  S,
  SEND,
  TITLE,
  asData,
  closing,
  codeFor,
  fileBytes,
  gate,
  hostOf,
  inPage,
  issueBody,
  openForm,
  readImage,
  rectOf,
  shotReady,
  statusLine,
  tag,
  thread,
  threadShown,
  titled,
  viewportWidth,
  visit,
  waitStatus,
  write,
} from "../us-lib/report.mjs";

const NOTE = Buffer.from("order 1042: card accepted, Pay disabled\n");
const isPost = (r) => r.method() === "POST" && new URL(r.url()).pathname === "/_p99/api/issues";
const isPut = (r) => r.method() === "PUT" && /^\/_p99\/api\/issues\/[^/]+\/attachments\//.test(new URL(r.url()).pathname);
const isItemGet = (r) => r.method() === "GET" && /^\/_p99\/api\/issues\/[^/]+$/.test(new URL(r.url()).pathname);

function losing() {
  const real = window.fetch;
  window.__p99Lose = true;
  window.__p99Lost = [];
  window.fetch = async function (input, init) {
    const url = new URL(String(input instanceof Request ? input.url : input), location.href);
    const method = (init && init.method) || (input instanceof Request ? input.method : "GET");
    if (!window.__p99Lose || method !== "POST" || url.pathname !== "/_p99/api/issues") return real.call(this, input, init);
    const answer = await real.call(this, input, init);
    const body = await answer.clone().json().catch(() => ({}));
    window.__p99Lost.push({ status: answer.status, key: body.key, uid: JSON.parse(init.body).client_uid });
    throw new TypeError("Failed to fetch");
  };
}

export default async function (kit) {
  const shop = hostOf(kit, "Shop");

  await kit.check("us-report-001 a report lands in its hosts project with its screenshot marked area and file", async () => {
    const code = await codeFor(kit, shop, GRACE);
    const { p, errors } = await visit(kit, shop, { code, path: "/checkout?order=1042" });
    await closing(p, async () => {
      await openForm(p);
      await shotReady(p);
      const title = tag("Pay stays grey after the card is accepted");
      await write(p, title, "Card accepted, but Pay never turns on.");
      await p.locator(S(".p99-mark-start")).click();
      await p.locator("p99-root >> .p99-mark-layer").waitFor({ timeout: 10000 });
      const box = await p.locator("#payment").boundingBox();
      const x = Math.max(4, box.x + 8);
      const y = Math.max(4, box.y + 8);
      await p.mouse.move(x, y);
      await p.mouse.down();
      await p.mouse.move(x + 200, y + 140, { steps: 8 });
      await p.mouse.up();
      await p.locator("p99-root >> .p99-mark-done").click();
      await p.locator(S(".p99-regions .p99-region img")).waitFor({ timeout: 30000 });
      await p.locator(S(".p99-new input[name=files]")).setInputFiles({ name: "order.txt", mimeType: "text/plain", buffer: NOTE });
      await p.locator(SEND).click();
      await threadShown(p);

      const items = await titled(kit, title);
      assert.equal(items.length, 1, "the report is filed once");
      const [item] = items;
      assert.equal(item.project, "Shop");
      assert.equal((await titled(kit, title, "&project=Shop")).length, 1, "the Shop project lists it");
      assert.equal((await titled(kit, title, "&project=Blog")).length, 0, "the Blog project does not");
      const shown = await p.locator(S("[data-view=item]")).textContent();
      assert.ok(shown.includes(item.key), `the thread shown is ${item.key}`);

      const t = await thread(kit, item.key);
      assert.equal(t.issue.project, "Shop");
      assert.deepEqual(t.attachments.map((a) => a.role).sort(), ["file", "region", "screenshot"]);
      const region = t.attachments.find((a) => a.role === "region");
      assert.equal(region.mark, 0);
      assert.equal(t.issue.marks.length, 1);
      assert.ok(t.issue.marks[0].elements.length > 0, "the mark names what was under it");
      const shot = t.attachments.find((a) => a.role === "screenshot");
      assert.ok(["image/webp", "image/jpeg"].includes(shot.type), shot.type);
      assert.ok(shot.bytes > 1000, `the screenshot is ${shot.bytes} bytes`);
      const file = t.attachments.find((a) => a.role === "file");
      assert.equal(Buffer.compare(await fileBytes(kit, file.id), NOTE), 0, "the file reads back byte for byte");
      assert.equal(t.issue.page.url, `https://${shop}/checkout`);
      assert.deepEqual(errors, []);
    });
  });

  await kit.check("us-report-001 a slow or lost send files exactly one item", async () => {
    const code = await codeFor(kit, shop, GRACE);

    {
      const { p } = await visit(kit, shop, { code });
      await closing(p, async () => {
        const posting = gate();
        const uploading = gate();
        const loading = gate();
        const posts = [];
        const puts = [];
        await p.route((u) => u.pathname.startsWith("/_p99/api/issues"), async (route) => {
          const r = route.request();
          if (isPost(r)) {
            posts.push(JSON.parse(r.postData()).client_uid);
            await posting.opened;
          } else if (isPut(r)) {
            puts.push(r.url());
            await uploading.opened;
          } else if (isItemGet(r)) {
            await loading.opened;
          }
          await route.fallback();
        });
        await openForm(p);
        await shotReady(p);
        const title = tag("Slow network, one item");
        await write(p, title);
        await p.locator(SEND).click();
        await kit.until("the held send", () => posts.length === 1);
        await waitStatus(p, /Sending/);
        assert.ok(await p.locator(SEND).isDisabled(), "Send is disabled while the send is held");
        await p.locator(TITLE).press("Enter");
        await p.locator(S("form.p99-new")).evaluate((f) => {
          f.requestSubmit();
          f.requestSubmit();
        });
        await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        assert.equal(posts.length, 1, "Enter and two more submits send nothing more");
        posting.open();
        await kit.until("the held upload", () => puts.length >= 1);
        uploading.open();
        loading.open();
        await threadShown(p);
        assert.equal(new Set(posts).size, 1, "every send carried one id");
        assert.equal((await titled(kit, title)).length, 1, "one item arrived");
      });
    }

    {
      const { p } = await visit(kit, shop, { code });
      await closing(p, async () => {
        const uids = [];
        p.on("request", (r) => isPost(r) && uids.push(JSON.parse(r.postData() || "{}").client_uid));
        await openForm(p);
        await shotReady(p);
        const title = tag("Sent from the train");
        await write(p, title, "The tunnel cut the signal.");
        await p.context().setOffline(true);
        try {
          await p.locator(SEND).click();
          await waitStatus(p, /offline/);
          assert.ok(await p.locator(RETRY).isVisible(), "Retry is offered");
          assert.equal(await p.locator(TITLE).inputValue(), title, "her words are kept");
          assert.equal((await titled(kit, title)).length, 0, "nothing reached the Worker while offline");
        } finally {
          await p.context().setOffline(false);
        }
        await p.locator(RETRY).click();
        await threadShown(p);
        assert.equal((await titled(kit, title)).length, 1, "Retry files it once");
        assert.ok(uids.length >= 1 && new Set(uids).size === 1, `every attempt carried one id (${uids.join(",")})`);
      });
    }

    {
      const { p } = await visit(kit, shop, { code, init: [losing] });
      await closing(p, async () => {
        await openForm(p);
        await shotReady(p);
        const title = tag("The answer got lost");
        await write(p, title);
        await p.locator(SEND).click();
        await p.locator(RETRY).waitFor({ timeout: 30000 });
        const said = (await statusLine(p)).replace(/\s*Retry$/, "");
        assert.equal(said, FAILED, "she reads P99's words, not the browser's");
        const lost = await p.evaluate(() => window.__p99Lost);
        assert.ok(lost.length >= 1, "the send reached the Worker");
        assert.equal(lost[0].status, 201);
        assert.ok(lost.slice(1).every((a) => a.status === 200 && a.key === lost[0].key), `repeats answer the same item (${JSON.stringify(lost)})`);
        assert.equal(new Set(lost.map((a) => a.uid)).size, 1, "every attempt carried one id");
        await p.evaluate(() => (window.__p99Lose = false));
        await p.locator(RETRY).click();
        await threadShown(p);
        const items = await titled(kit, title);
        assert.equal(items.length, 1, "one item exists");
        assert.equal(items[0].key, lost[0].key, "the item stored the first time is the one kept");
        assert.ok((await p.locator(S("[data-view=item]")).textContent()).includes(lost[0].key), "Retry opens that item");
      });
    }
  });

  await kit.check("us-report-001 a visitor at the daily limit is told why and keeps her words", async () => {
    const hedy = { name: "Hedy Lamarr", email: `hedy.${RUN}@example.com` };
    const code = await codeFor(kit, shop, hedy);
    const { p } = await visit(kit, shop, { code });
    await closing(p, async () => {
      for (let i = 0; i < 30; i++) {
        const r = await inPage(p, "POST", "/issues", code, issueBody("/checkout", { title: tag(`Earlier today ${i}`) }));
        assert.equal(r.status, 201, `filing the day's item ${i} answered ${r.status} ${r.text}`);
      }
      const posts = [];
      p.on("request", (r) => isPost(r) && posts.push(r.url()));
      await openForm(p);
      const title = tag("One more today");
      await write(p, title, "It still happens.");
      await p.locator(SEND).click();
      await waitStatus(p, /today's limit of 30 items/);
      assert.equal(await p.locator(TITLE).inputValue(), title, "the title is kept");
      assert.equal(await p.locator(S(".p99-new textarea[name=body]")).inputValue(), "It still happens.", "the text is kept");
      assert.ok(!(await p.locator(SEND).isDisabled()), "Send works again");
      assert.ok(!(await p.locator(RETRY).isVisible()), "no Retry for a limit that holds all day");
      assert.equal(posts.length, 1, "she is told at once, with no hidden retries");
      assert.equal((await titled(kit, title)).length, 0, "nothing is filed");
    });
  });

  await kit.check("us-report-002 a capture of the checkout page leaves the card and password blank", async () => {
    const code = await codeFor(kit, shop, GRACE);
    const secret = `hunter2-${RUN}`;
    const { p } = await visit(kit, shop, { code, path: "/checkout?order=1042&token=abc" });
    await closing(p, async () => {
      await p.evaluate(() => {
        const label = document.createElement("label");
        label.htmlFor = "us-pass";
        label.textContent = "Account password";
        const input = document.createElement("input");
        input.type = "password";
        input.id = "us-pass";
        input.autocomplete = "off";
        document.querySelector("#card").after(label, input);
      });
      await p.locator("#us-pass").fill(secret);
      await p.locator("#card").fill("4242 4242 4242 4242");
      const width = await viewportWidth(p);
      const rects = [await rectOf(p, "#card"), await rectOf(p, "#us-pass"), await rectOf(p, "#name")];
      await openForm(p);
      await shotReady(p);
      const title = tag("The card field at checkout");
      await write(p, title);
      await p.locator(SEND).click();
      await threadShown(p);
      const [item] = await titled(kit, title);
      assert.ok(item, "the report is filed");
      const t = await thread(kit, item.key);
      const shot = t.attachments.find((a) => a.role === "screenshot");
      assert.ok(shot, "it carries a screenshot");
      const read = await readImage(p, { src: asData(await fileBytes(kit, shot.id), shot.type), width, rects });
      const [card, pass, name] = read.spreads;
      assert.ok(card >= 0 && card <= 30, `the card field is one solid block (${JSON.stringify(read)})`);
      assert.ok(pass >= 0 && pass <= 30, `the password is one solid block (${JSON.stringify(read)})`);
      assert.ok(name > 80, `the name field still shows, so the read can fail (${JSON.stringify(read)})`);
      const stored = JSON.stringify(t);
      assert.ok(!stored.includes("4242 4242"), "no card number rides along");
      assert.ok(!stored.includes(secret), "no password rides along");
      assert.equal(t.issue.page.url, `https://${shop}/checkout`, "the page address loses its query");
    });
  });
}
