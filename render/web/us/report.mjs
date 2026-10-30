import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  FAILED,
  GRACE,
  RETRY,
  RUN,
  S,
  SEND,
  TITLE,
  apart,
  asData,
  closing,
  codeFor,
  fileBytes,
  gate,
  hostOf,
  inPage,
  issueBody,
  listButton,
  openForm,
  plus,
  previewSrc,
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

const LOCKUP_SHA256 = "100522278893631671db6534422f10c9a62b4ffcbb1c25b2c47517c42b222a45";
const NOTE = Buffer.from("order 1042: card accepted, Pay disabled\n");
const HIDE = S(".p99-new input[name=mask]");
const NOTE_HIDDEN = "Passwords and the fields this site marks as private are blanked.";
const NOTE_SHOWN = "Passwords are blanked; you chose to show this site's private areas.";
const privacyNote = (p) => p.locator(S(".p99-new .p99-privacy")).textContent();
const capturing = (p) => p.locator(S(".p99-new .p99-shot-wait")).count();
const recaptured = (p) =>
  p.waitForFunction(() => {
    const f = document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open .p99-new");
    return f && !f.querySelector(".p99-shot-wait") && f.querySelector(".p99-shot[data-role=screenshot] canvas") && !f.querySelector("input[name=mask]").disabled;
  }, null, { timeout: 30000 });

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
      await p.locator(S(".p99-regions .p99-region canvas")).waitFor({ timeout: 30000 });
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
      await waitStatus(p, /today's limit of 30 cards/);
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
      const [cardMean, passMean, nameMean] = read.means;
      assert.ok(apart(cardMean, passMean) <= 12, `the password is painted the same colour as the card (${JSON.stringify(read.means)})`);
      assert.ok(apart(cardMean, nameMean) > 12, `the name field is not that colour (${JSON.stringify(read.means)})`);
      assert.ok(name > 80, `the name field still shows, so the read can fail (${JSON.stringify(read)})`);
      const stored = JSON.stringify(t);
      assert.ok(!stored.includes("4242 4242"), "no card number rides along");
      assert.ok(!stored.includes(secret), "no password rides along");
      assert.equal(t.issue.page.url, `https://${shop}/checkout`, "the page address loses its query");
    });
  });

  await kit.check("us-report-002 the reporter can show the sites private areas and a password stays blank", async () => {
    const code = await codeFor(kit, shop, GRACE);
    const secret = `hunter2-${RUN}`;
    const { p, errors } = await visit(kit, shop, { code });
    await closing(p, async () => {
      await p.evaluate(() => {
        const note = document.createElement("p");
        note.id = "us-private";
        note.setAttribute("data-p99-redact", "");
        note.textContent = "Grace Hopper · 12 Analytical Row · +44 20 7946 0000";
        note.style.cssText = "position:absolute;left:48px;top:96px;z-index:9;margin:0;width:520px;height:56px;padding:12px 16px;box-sizing:border-box;background:#fff7d6;color:#1a1200;font:700 22px system-ui";
        const pass = document.createElement("input");
        pass.type = "password";
        pass.id = "us-pass";
        pass.style.cssText = "position:absolute;left:600px;top:96px;z-index:9;width:240px;height:56px;box-sizing:border-box;background:#ffffff;color:#000000;font:700 28px monospace";
        document.body.append(note, pass);
      });
      await p.locator("#us-pass").fill(secret);
      const width = await viewportWidth(p);
      const rects = [await rectOf(p, "#us-private"), await rectOf(p, "#us-pass")];
      await openForm(p);
      await shotReady(p);
      const read = async () => readImage(p, { src: await previewSrc(p, ".p99-shot[data-role=screenshot] canvas"), width, rects });

      assert.ok(await p.locator(HIDE).isVisible(), "the form offers to hide this site's private areas");
      assert.ok(await p.locator(HIDE).isChecked(), "hiding them is the default");
      assert.equal(await p.locator(S(".p99-pick[data-role=mask] span")).textContent(), "Hide this site's private areas");
      assert.ok((await privacyNote(p)).endsWith(NOTE_HIDDEN));
      const masked = await read();
      assert.ok(masked.spreads[0] <= 30, `the private area is one solid block (${JSON.stringify(masked)})`);
      assert.ok(masked.spreads[1] <= 30, `the password is one solid block (${JSON.stringify(masked)})`);

      await p.locator(HIDE).uncheck();
      await recaptured(p);
      const shown = await read();
      assert.ok(shown.spreads[0] > 60, `the private area's own pixels show in the preview (${JSON.stringify(shown)})`);
      assert.ok(shown.spreads[1] <= 30, `the password is still one solid block (${JSON.stringify(shown)})`);
      assert.ok((await privacyNote(p)).endsWith(NOTE_SHOWN), "the note says she chose to show them");

      await p.locator(HIDE).check();
      assert.equal(await capturing(p), 0, "checking it again reuses the masked capture, with no new one");
      const again = await read();
      assert.ok(again.spreads[0] <= 30 && apart(again.means[0], masked.means[0]) <= 12, `the private area is hidden again (${JSON.stringify(again)})`);
      assert.ok((await privacyNote(p)).endsWith(NOTE_HIDDEN));

      await p.locator(HIDE).uncheck();
      assert.equal(await capturing(p), 0, "unchecking once more reuses the capture that shows them");
      const title = tag("The address line on the checkout");
      await write(p, title);
      await p.locator(SEND).click();
      await threadShown(p);
      const [item] = await titled(kit, title);
      assert.ok(item, "the report is filed");
      const t = await thread(kit, item.key);
      const shot = t.attachments.find((a) => a.role === "screenshot");
      assert.ok(shot, "it carries a screenshot");
      const sent = await readImage(p, { src: asData(await fileBytes(kit, shot.id), shot.type), width, rects });
      assert.ok(sent.spreads[0] > 60, `the stored screenshot shows the private area (${JSON.stringify(sent)})`);
      assert.ok(sent.spreads[1] <= 30, `the stored screenshot keeps the password one solid block (${JSON.stringify(sent)})`);
      assert.ok(!JSON.stringify(t).includes(secret), "no password rides along");
      assert.deepEqual(errors, []);
    });
  });

  await kit.check("us-report-002 a page with nothing to hide offers no choice", async () => {
    const code = await codeFor(kit, shop, GRACE);
    const { p, errors } = await visit(kit, shop, { code, path: "/strict.html" });
    await closing(p, async () => {
      assert.equal(await p.evaluate(() => document.querySelectorAll("[data-p99-redact]").length), 0, "the page marks nothing private");
      await openForm(p);
      await shotReady(p);
      assert.equal(await p.locator(HIDE).count(), 1);
      assert.ok(!(await p.locator(HIDE).isVisible()), "no hide checkbox shows");
      assert.ok((await privacyNote(p)).endsWith(NOTE_HIDDEN), "the note keeps its wording");
      assert.deepEqual(errors, []);
    });
  });

  await kit.check("us-report-001 the plus and the panel say card never report or item", async () => {
    const code = await codeFor(kit, shop, GRACE);
    const { p, errors } = await visit(kit, shop, { code });
    await closing(p, async () => {
      const words = (sel) =>
        p.evaluate((sel) => {
          const r = document.querySelector("p99-root").shadowRoot;
          const box = r.querySelector(sel).cloneNode(true);
          for (const own of box.querySelectorAll(".p99-item-title, [data-view=item] #p99-title, .p99-body, .p99-page, .p99-files, .p99-path, .p99-lockup, textarea, input[name=title]")) own.remove();
          const said = [box.textContent];
          for (const el of box.querySelectorAll("[aria-label], [title], [alt], [placeholder]")) for (const a of ["aria-label", "title", "alt", "placeholder"]) if (el.hasAttribute(a)) said.push(el.getAttribute(a));
          return said.join(" \n ");
        }, sel);
      const NOT = /\b(report|reports|reporter|reported|item|items)\b/i;
      assert.equal(await plus(p).getAttribute("title"), "New card: a bug or idea");
      assert.equal(await plus(p).evaluate((b) => b.ariaLabel), "New card: a bug or idea");
      await openForm(p);
      await shotReady(p);
      const title = tag("The total stays at zero");
      await write(p, title, "It never adds the shipping.");
      await p.locator(SEND).click();
      await threadShown(p);
      await p.waitForFunction(() => /Filed by/.test(document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open [data-view=item] .p99-meta")?.textContent || ""), null, { timeout: 20000 });
      const meta = await p.locator(S("[data-view=item] .p99-item-head .p99-meta")).textContent();
      assert.ok(meta.startsWith(`Filed by ${GRACE.name}, `), meta);
      const history = await p.locator(S("[data-view=item] .p99-thread")).textContent();
      assert.ok(history.includes("opened the card"), history);
      const thread = await words(".p99-panel.is-open");
      assert.ok(!NOT.test(thread), `the thread says ${thread.match(NOT)?.[0]}: ${thread}`);
      await p.waitForFunction(() => /^Your cards: \d+ waiting, \d+ on this page$/.test(document.querySelector("p99-root").shadowRoot.querySelector(".w .b:not(.f)")?.ariaLabel || ""), null, { timeout: 20000 });
      await p.keyboard.press("Escape");
      await p.waitForFunction(() => !document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open"), null, { timeout: 20000 });
      await listButton(p).click();
      await p.locator(S("[data-view=list] .p99-results .p99-item")).first().waitFor({ timeout: 20000 });
      assert.equal(await p.locator(S("[data-view=list] #p99-title")).textContent(), "Cards");
      assert.equal(await p.locator(S("[data-view=list] .p99-tabs")).getAttribute("aria-label"), "Cards");
      const listed = await words(".p99-panel.is-open");
      assert.ok(!NOT.test(listed), `the list says ${listed.match(NOT)?.[0]}: ${listed}`);
      assert.deepEqual(errors, []);
    });
  });

  await kit.check("us-report-002 each capture checkbox sits on one row with its label", async () => {
    const code = await codeFor(kit, shop, GRACE);
    for (const scheme of ["light", "dark"]) {
      const { p, errors } = await visit(kit, shop, { code, scheme });
      await closing(p, async () => {
        await p.evaluate(() => {
          const note = document.createElement("p");
          note.setAttribute("data-p99-redact", "");
          note.textContent = "Grace Hopper · 12 Analytical Row";
          note.style.cssText = "position:absolute;left:48px;top:96px;z-index:9;margin:0;width:360px;height:40px;background:#fff7d6;color:#1a1200";
          document.body.append(note);
        });
        await openForm(p);
        await shotReady(p);
        await p.locator(HIDE).waitFor({ state: "visible", timeout: 10000 });
        const rows = await p.evaluate(() =>
          Array.from(document.querySelector("p99-root").shadowRoot.querySelectorAll(".p99-panel.is-open .p99-shots-pick > .p99-pick"), (d) => {
            const box = d.querySelector("input").getBoundingClientRect();
            const text = d.querySelector("label span").getBoundingClientRect();
            return { role: d.dataset.role, dy: Math.abs((box.top + box.bottom) / 2 - (text.top + text.bottom) / 2), gap: text.left - box.right };
          }),
        );
        assert.deepEqual(rows.map((r) => r.role), ["mask", "screenshot", "page", "region"], `${scheme}: ${JSON.stringify(rows)}`);
        assert.ok(rows.every((r) => r.dy <= 2 && r.gap > 0 && r.gap < 24), `${scheme}: each box comes first, its label beside it on the same row ${JSON.stringify(rows)}`);
        assert.deepEqual(errors, []);
      });
    }
  });

  await kit.check("us-report-001 the panel lockup keeps its tagline and alt text", async () => {
    const code = await codeFor(kit, shop, GRACE);
    const { p, errors } = await visit(kit, shop, { code });
    await closing(p, async () => {
      await openForm(p);
      await p.waitForFunction(() => {
        const i = document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open .p99-lockup");
        return i && i.complete && i.naturalWidth > 0;
      }, null, { timeout: 20000 });
      const lockup = await p.evaluate(async () => {
        const i = document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open .p99-lockup");
        const box = i.getBoundingClientRect();
        const bytes = new Uint8Array(await (await fetch(i.src)).arrayBuffer());
        let raw = "";
        for (const b of bytes) raw += String.fromCharCode(b);
        return { path: new URL(i.src).pathname, alt: i.alt, shown: box.width > 0 && box.height > 0, bytes: btoa(raw) };
      });
      const sum = createHash("sha256").update(Buffer.from(lockup.bytes, "base64")).digest("hex");
      assert.deepEqual({ path: lockup.path, alt: lockup.alt, shown: lockup.shown }, { path: "/_p99/art/lockup-dark.svg", alt: "P99, issue and feedback reporter", shown: true });
      assert.equal(sum, LOCKUP_SHA256, "the lockup, its ISSUE & FEEDBACK REPORTER tagline included, is the one picked on 2026-10-14");
      assert.deepEqual(errors, []);
    });
  });
}
