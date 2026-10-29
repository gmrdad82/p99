import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ADA, GRACE, RUN, S, closing, codeFor, hostOf, inPage, issueBody, listButton, signed, tag, visit } from "../../render/web/us-lib/report.mjs";

const scratch = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "tmp", "us-follow");

async function p99(kit, args) {
  const out = await kit.p99(args);
  assert.equal(out.code, 0, `p99 ${args.join(" ")}: ${out.stderr}`);
  return out;
}

async function fileAs(kit, host, code, title) {
  const { p } = await visit(kit, host, { code });
  return closing(p, async () => {
    const r = await inPage(p, "POST", "/issues", code, issueBody("/checkout", { title }));
    assert.equal(r.status, 201, r.text);
    return r.json.key;
  });
}

async function openThread(p, key, text) {
  await p.evaluate((k) => window.P99.open(k), key);
  await p.locator(S("[data-view=item]")).waitFor({ timeout: 20000 });
  if (text) await p.locator(S(".p99-comment .p99-body"), { hasText: text }).first().waitFor({ timeout: 20000 });
}

const listed = (p) =>
  p.evaluate(() => {
    const view = document.querySelector("p99-root").shadowRoot.querySelector(".p99-panel.is-open [data-view=list]");
    const res = view && view.querySelector(".p99-results");
    if (!res || res.hasAttribute("aria-busy") || res.querySelector(".p99-rows-wait")) return null;
    return Array.from(res.querySelectorAll(".p99-item"), (li) => ({ key: li.querySelector(".p99-key")?.textContent || "", unread: li.dataset.unread === "true", text: li.textContent }));
  });

export default async function (kit) {
  const shop = hostOf(kit, "Shop");

  await kit.check("us-follow-001 adas reply shows as new in graces list and reads in her thread", async () => {
    const code = await codeFor(kit, shop, GRACE);
    const hedy = await codeFor(kit, shop, { name: "Hedy Lamarr", email: `hedy.${RUN}@example.com` });
    const key = await fileAs(kit, shop, code, tag("The receipt never arrives"));
    const theirs = await fileAs(kit, shop, hedy, tag("Hedy's own report"));
    const reply = `Fixed on our side; please try again. [${RUN}]`;
    await p99(kit, ["comment", key, reply, "--host", shop]);

    const { p } = await visit(kit, shop, { code });
    await closing(p, async () => {
      const badge = await kit.until("the unread count", () =>
        p.evaluate(() => {
          const n = document.querySelector("p99-root").shadowRoot.querySelector(".w .b:not(.f) .n");
          return n && n.textContent && n.classList.contains("u") ? n.textContent : "";
        }),
      );
      assert.ok(Number(badge) >= 1, `the list button shows her unread count in the accent (${badge})`);
      await listButton(p).click();
      await p.locator(S(".p99-tabs a[data-scope=mine]")).click();
      const rows = await kit.until("Your items", () => listed(p));
      const mine = rows.find((r) => r.key === key);
      assert.ok(mine, `Your items lists her item (${JSON.stringify(rows)})`);
      assert.ok(mine.unread, "it is marked new");
      assert.ok(!rows.some((r) => r.key === theirs), "never another person's item");

      await openThread(p, key, reply);
      const said = await p.evaluate((text) => {
        const li = Array.from(document.querySelector("p99-root").shadowRoot.querySelectorAll(".p99-panel.is-open .p99-comment")).find((c) => c.textContent.includes(text));
        return li ? { owner: li.dataset.owner, margin: parseFloat(getComputedStyle(li).marginRight) } : null;
      }, reply);
      assert.ok(said, "the thread shows Ada's reply");
      assert.equal(said.owner, "true", "marked as an Owner's");
      assert.ok(said.margin > 0, `set off from the edge (${said.margin})`);
    });
  });

  await kit.check("us-follow-001 graces answer in the panel lands on the item", async () => {
    const code = await codeFor(kit, shop, GRACE);
    const key = await fileAs(kit, shop, code, tag("The total does not update"));
    const answer = `It still shows zero on my phone. [${RUN}]`;
    const { p } = await visit(kit, shop, { code });
    await closing(p, async () => {
      await openThread(p, key);
      await p.locator(S(".p99-comment-form textarea[name=body]")).fill(answer);
      await p.locator(S(".p99-comment-form button[type=submit]")).click();
      await p.locator(S(".p99-comment .p99-body"), { hasText: answer }).first().waitFor({ timeout: 20000 });
    });
    const shown = JSON.parse((await p99(kit, ["show", key, "--json", "--host", shop])).stdout);
    const fromCli = (shown.comments || []).find((c) => c.body === answer);
    assert.ok(fromCli, `p99 show lists her answer: ${JSON.stringify(shown.comments)}`);
    assert.equal(fromCli.author.name, GRACE.name);
    assert.equal(fromCli.internal, false);
    const t = (await signed(kit, "GET", `/issues/${key}`)).json;
    const fromApi = t.comments.find((c) => c.body === answer);
    assert.ok(fromApi, "the signed API reads the same answer");
    assert.equal(fromApi.author.email, GRACE.email);
  });

  await kit.check("us-follow-001 grace never sees an internal note or an owners email", async () => {
    const code = await codeFor(kit, shop, GRACE);
    const key = await fileAs(kit, shop, code, tag("Charged twice"));
    mkdirSync(scratch, { recursive: true });
    const notes = join(scratch, `refund-${RUN}.txt`);
    writeFileSync(notes, "refund ledger: order 1042\n");
    const note = `Internal: check the refund ledger before replying. [${RUN}]`;
    const reply = `We are looking into it. [${RUN}]`;
    await p99(kit, ["comment", key, note, "--internal", "--attach", notes, "--host", shop]);
    await p99(kit, ["comment", key, reply, "--host", shop]);
    const owners = (await signed(kit, "GET", `/issues/${key}`)).json;
    assert.ok(owners.comments.some((c) => c.body === note && c.internal), "the Owners see the note");

    const { p } = await visit(kit, shop, { code });
    await closing(p, async () => {
      const sent = await inPage(p, "GET", `/issues/${key}`, code);
      assert.equal(sent.status, 200);
      assert.ok(sent.text.includes(reply), "Grace reads the public reply");
      for (const hidden of [note, `refund-${RUN}.txt`, ADA.email]) assert.ok(!sent.text.includes(hidden), `the Worker never sends Grace ${hidden}`);

      await openThread(p, key, reply);
      const panel = await p.evaluate(() => {
        const root = document.querySelector("p99-root").shadowRoot;
        return { html: root.innerHTML, internal: root.querySelectorAll(".p99-panel.is-open .p99-comment[data-internal=true]").length };
      });
      assert.equal(panel.internal, 0, "no internal comment is drawn");
      for (const hidden of [note, `refund-${RUN}.txt`, ADA.email]) assert.ok(!panel.html.includes(hidden), `the panel never shows ${hidden}`);
    });
  });
}
