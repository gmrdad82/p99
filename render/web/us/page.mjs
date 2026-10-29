import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const TAG = randomUUID().slice(0, 6);
const ADA = { email: "ada@example.com", name: "Ada Lovelace", agent: false };
const SHOP = "us-shop.example.com";
const DOCS = "us-docs.example.com";
const PROJECT = { shop: "Us Shop", docs: "Us Docs", ops: "Us Ops" };
const BADGES = { free: "Free", studio: "Studio", agency: "Agency", owner: "Owner", ff: "F&F" };
const WORDS = {
  denied: "That e-mail and code don't match. Check the e-mail, wait for the next code and try again.",
  limited: "Too many tries. Wait a few minutes, then try again.",
  failed: "Something went wrong; try again.",
  offline: "You're offline; try again when you're back.",
  none: "Nothing in this space is open to you yet. Ask the person who invited you for a P99 link.",
  pictureBad: "That file isn't a picture P99 can read; pick a PNG, JPEG or WebP.",
  pictureSaved: "Your picture is saved.",
  pictureRemoved: "Your picture is gone; the pattern is back.",
  licenceSaved: "Saved. The badge shows the licence now.",
  licenceEmpty: "Paste a licence key first.",
  badName: "Use 3 to 30 lowercase letters, digits, dots, dashes or underscores, starting and ending with a letter or digit.",
  taken: "That username is taken; try another.",
};

function wrong(code) {
  return code.slice(0, 5) + String((Number(code[5]) + 1) % 10);
}

const screen = (p) => p.locator("#app").getAttribute("data-screen");

async function waitScreen(p, name) {
  await p.waitForFunction((n) => document.getElementById("app").dataset.screen === n && !document.querySelector("#app .app-wait"), name);
}

async function said(p) {
  const error = p.locator("#signin .app-error");
  await error.waitFor({ state: "visible" });
  await p.waitForFunction(() => !document.querySelector("#signin button[type=submit]").disabled);
  return error.textContent();
}

async function signIn(p, email, totp) {
  await p.fill("#signin input[name=email]", email);
  await p.fill("#signin input[name=totp]", totp);
  await p.click("#signin button[type=submit]");
}

async function itemsShown(p) {
  await waitScreen(p, "items");
  await p.waitForFunction(() => document.querySelector("p99-root.app-full")?.shadowRoot?.querySelector(".p99-panel.is-open [data-view=list]"), null, { timeout: 15000 });
}

async function boardShown(p) {
  await waitScreen(p, "board");
  await p.waitForFunction(() => {
    const r = document.querySelector("p99-root.app-board")?.shadowRoot;
    return r && r.querySelector(".p99-board.is-page.is-open") && (r.querySelector(".p99-col[data-label]") || r.querySelector(".p99-board-state"));
  }, null, { timeout: 15000 });
}

async function listShows(p, wanted, absent = []) {
  await p.waitForFunction(([wanted, absent]) => {
    const text = document.querySelector("p99-root.app-full")?.shadowRoot?.textContent || "";
    return wanted.every((t) => text.includes(t)) && absent.every((t) => !text.includes(t));
  }, [wanted, absent], { timeout: 15000 });
}

async function boardShows(p, wanted, absent = []) {
  await p.waitForFunction(([wanted, absent]) => {
    const text = document.querySelector("p99-root.app-board")?.shadowRoot?.textContent || "";
    return wanted.every((t) => text.includes(t)) && absent.every((t) => !text.includes(t));
  }, [wanted, absent], { timeout: 15000 });
}

async function header(p) {
  return p.evaluate(() => {
    const bar = document.querySelector(".app-bar");
    if (!bar) return null;
    const r = bar.getBoundingClientRect();
    const mark = bar.querySelector("a.app-mark");
    const badge = bar.querySelector(".app-badge");
    return {
      rect: [r.left, r.top, r.width, r.height].map(Math.round),
      position: getComputedStyle(bar).position,
      mark: mark ? mark.getAttribute("href") : null,
      name: bar.querySelector(".app-space-name")?.textContent ?? null,
      badge: badge ? badge.getAttribute("src") : null,
      sites: document.querySelectorAll(".app-space, .app-spaces").length,
    };
  });
}

function asks(p, path, init = {}) {
  return p.evaluate(async ([path, init]) => {
    const headers = { "X-P99-App": "1", Accept: "application/json", ...(init.headers || {}) };
    const r = await fetch(path, { credentials: "same-origin", ...init, headers });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: r.status, json };
  }, [path, init]);
}

async function picturePng(p, w, h) {
  const b64 = await p.evaluate(([w, h]) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    g.fillStyle = "#ff0000";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#0000ff";
    g.fillRect((w - h) / 2, 0, h, h);
    return c.toDataURL("image/png").split(",")[1];
  }, [w, h]);
  return Buffer.from(b64, "base64");
}

export default async function (kit) {
  const { check, call } = kit;
  const signed = (method, path, body, actor = ADA) => call(method, "/_p99/v1" + path, { actor, body });

  let numbered = 0;

  const visit = async (path, run) => {
    numbered += 1;
    const p = await kit.page({
      viewport: { width: 1280, height: 860 },
      deviceScaleFactor: 1,
      extraHTTPHeaders: { "cf-connecting-ip": `198.51.100.${(numbered % 250) + 1}` },
    });
    const ctx = p.context();
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    try {
      await p.goto(kit.appUrl(path));
      return await run({ p, ctx, errors });
    } finally {
      await ctx.close();
    }
  };

  let fixture = null;
  const world = () =>
    (fixture ??= (async () => {
      for (const name of Object.values(PROJECT)) {
        const made = await signed("POST", "/projects", { name });
        assert.ok(made.status === 201 || made.status === 409, JSON.stringify(made.json));
      }
      for (const [host, project] of [[SHOP, PROJECT.shop], [DOCS, PROJECT.docs]]) {
        const put = await signed("PUT", `/hosts/${host}`, { env: "production", project, config: {} });
        assert.equal(put.status, 200, JSON.stringify(put.json));
      }
    })());

  let people = 0;
  const email = (first) => `${first}.${TAG}.${++people}@example.com`;

  const person = async ({ name, grant, owner = false, mail = email(name.split(" ")[0].toLowerCase()) }) => {
    await world();
    const made = await signed("POST", "/codes", { name, email: mail, grant, role: owner ? "owner" : "user", totp: true, mail: false });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    return { name, email: mail, id: made.json.code.id, key: made.json.totp_key };
  };

  const report = async (host, title, by) => {
    const filed = await signed(
      "POST",
      `/issues?host=${host}`,
      { client_uid: randomUUID(), kind: "bug", title, body: "", page: { url: `https://${host}/cart`, path: "/cart", title: "Cart" }, context: {}, marks: [] },
      { email: by.email, name: by.name, agent: false },
    );
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    return filed.json.key;
  };

  const profile = async (p) => {
    await p.evaluate(() => (location.hash = "#profile"));
    await waitScreen(p, "profile");
  };

  const licenceOf = async (p) => (await asks(p, "/_p99/api/me")).json.licence;

  await check("us-page-001 the right code opens the space and sign out ends the session", async () => {
    const grace = await person({ name: "Grace Hopper", grant: { projects: [PROJECT.shop] } });
    const title = `The cart total stays at zero ${TAG}`;
    await report(SHOP, title, grace);
    await visit("/", async ({ p, errors }) => {
      assert.equal(await screen(p), "signin");
      await signIn(p, ` ${grace.email.toUpperCase()} `, kit.totp(grace.key).replace(/^(\d{3})/, "$1 "));
      await itemsShown(p);
      await listShows(p, [title]);
      const listed = await asks(p, "/_p99/app/spaces");
      assert.equal(listed.status, 200);
      const top = await header(p);
      assert.equal(top.position, "fixed");
      assert.ok(kit.space.name, "the seeded space has a name");
      assert.equal(listed.json.space?.name, kit.space.name);
      assert.equal(top.name, kit.space.name);
      assert.ok(top.badge.startsWith(`/_p99/badges/${listed.json.license}.svg?v=`), top.badge);
      assert.equal(top.sites, 0);
      await p.reload();
      await itemsShown(p);
      await profile(p);
      await p.click(".app-profile .app-actions .app-quiet");
      await waitScreen(p, "signin");
      assert.equal(await p.evaluate(() => location.hash), "");
      assert.equal((await asks(p, "/_p99/app/spaces")).status, 401);
      await p.goto(kit.appUrl("/"));
      assert.equal(await screen(p), "signin");
      assert.deepEqual(errors, []);
    });
  });

  await check("us-page-001 a wrong code clears the code and keeps the email", async () => {
    const grace = await person({ name: "Grace Hopper", grant: { projects: [PROJECT.shop] } });
    await visit("/", async ({ p }) => {
      await signIn(p, grace.email, wrong(kit.totp(grace.key)));
      assert.equal(await said(p), WORDS.denied);
      assert.equal(await p.inputValue("#signin input[name=totp]"), "");
      assert.equal(await p.inputValue("#signin input[name=email]"), grace.email);
      assert.equal(await p.locator("#signin input[name=totp]").evaluate((e) => e === document.activeElement), true);
      assert.equal(await p.textContent("#signin button[type=submit]"), "Sign in");
      await signIn(p, `nobody.${TAG}@example.com`, kit.totp(grace.key));
      assert.equal(await said(p), WORDS.denied);
      await signIn(p, grace.email, kit.totp(grace.key));
      await itemsShown(p);
    });
  });

  await check("us-page-001 too many tries say to wait and keep the email", async () => {
    const grace = await person({ name: "Grace Hopper", grant: { projects: [PROJECT.shop] } });
    await visit("/", async ({ p }) => {
      const answers = [];
      for (let i = 0; i < 11 && answers.at(-1) !== WORDS.limited; i++) {
        await signIn(p, grace.email, wrong(kit.totp(grace.key)));
        answers.push(await said(p));
      }
      assert.equal(answers.at(-1), WORDS.limited, JSON.stringify(answers));
      assert.ok(answers.length >= 6, JSON.stringify(answers));
      assert.ok(answers.slice(0, -1).every((a) => a === WORDS.denied), JSON.stringify(answers));
      assert.equal(await screen(p), "signin");
      assert.equal(await p.inputValue("#signin input[name=totp]"), "");
      assert.equal(await p.inputValue("#signin input[name=email]"), grace.email);
      await signIn(p, grace.email, kit.totp(grace.key));
      assert.equal(await said(p), WORDS.limited);
      assert.equal(await screen(p), "signin");
    });
  });

  await check("us-page-001 a revoked codes session lands on the sign in form", async () => {
    const grace = await person({ name: "Grace Hopper", grant: { projects: [PROJECT.shop] } });
    await report(SHOP, `Revoked, so unseen ${TAG}`, grace);
    await visit("/", async ({ p }) => {
      await signIn(p, grace.email, kit.totp(grace.key));
      await itemsShown(p);
      const revoked = await signed("POST", `/codes/${grace.id}/revoke`);
      assert.equal(revoked.status, 200, JSON.stringify(revoked.json));
      await p.goto(kit.appUrl("/"));
      await waitScreen(p, "signin");
      assert.equal(await p.locator("#signin .app-error").isHidden(), true);
      assert.equal(await p.locator("p99-root").count(), 0);
      assert.equal((await asks(p, "/_p99/app/spaces")).status, 401);
    });
  });

  await check("us-page-002 a user opens her own items under the project strip", async () => {
    const grant = { projects: [PROJECT.shop, PROJECT.docs] };
    const grace = await person({ name: "Grace Hopper", grant });
    const mary = await person({ name: "Mary Jackson", grant });
    const hers = [`Grace's cart total ${TAG}`, `Grace's search ${TAG}`];
    const marys = [`Mary's cart total ${TAG}`, `Mary's search ${TAG}`];
    await report(SHOP, hers[0], grace);
    await report(DOCS, hers[1], grace);
    await report(SHOP, marys[0], mary);
    await report(DOCS, marys[1], mary);
    await visit("/", async ({ p }) => {
      await signIn(p, grace.email, kit.totp(grace.key));
      await itemsShown(p);
      await p.waitForFunction((titles) => {
        const text = document.querySelector("p99-root.app-full")?.shadowRoot?.textContent || "";
        return titles.some((t) => text.includes(t));
      }, hers, { timeout: 15000 });
      await p.waitForFunction((titles) => {
        const text = document.querySelector("p99-root.app-full")?.shadowRoot?.textContent || "";
        return titles.every((t) => text.includes(t));
      }, hers, { timeout: 15000 });
      const text = await p.evaluate(() => document.querySelector("p99-root.app-full").shadowRoot.textContent);
      for (const title of marys) assert.equal(text.includes(title), false, title);
      const chips = await p.locator(".app-project").evaluateAll((list) => list.map((b) => [b.dataset.name, b.getAttribute("aria-pressed")]));
      assert.deepEqual(chips[0], ["", "true"]);
      assert.deepEqual(chips.slice(1).sort(), [[PROJECT.docs, "false"], [PROJECT.shop, "false"]]);
      assert.equal((await header(p)).sites, 0);
      assert.equal(await p.locator("p99-root").count(), 1);
    });
  });

  await check("us-page-002 an owner opens the board and narrows it by project", async () => {
    const ada = await person({ name: "Ada Lovelace", grant: { projects: [PROJECT.shop, PROJECT.docs] }, owner: true });
    const reporter = { name: "Grace Hopper", email: email("grace") };
    const inShop = `Shop report ${TAG}`;
    const inDocs = `Docs report ${TAG}`;
    await report(SHOP, inShop, reporter);
    await report(DOCS, inDocs, reporter);
    await visit("/", async ({ p }) => {
      const asked = [];
      p.on("request", (r) => {
        const u = new URL(r.url());
        if (u.pathname === "/_p99/api/board") asked.push(u.searchParams);
      });
      await signIn(p, ada.email, kit.totp(ada.key));
      await boardShown(p);
      await boardShows(p, [inShop, inDocs]);
      assert.equal(asked[0]?.has("host"), false, "the All board asked one host instead of the whole reachable space");
      const chips = await p.locator(".app-project").evaluateAll((list) => list.map((b) => [b.dataset.name, b.querySelector(".app-hosts")?.textContent ?? null, b.getAttribute("aria-pressed")]));
      assert.deepEqual(chips[0], ["", null, "true"]);
      assert.deepEqual(chips.slice(1).sort(), [[PROJECT.docs, DOCS, "false"], [PROJECT.shop, SHOP, "false"]]);
      assert.equal((await header(p)).sites, 0);
      const only = async (project, shown, hidden) => {
        const board = p.waitForResponse((r) => new URL(r.url()).pathname === "/_p99/api/board");
        await p.click(`.app-project[data-name="${project}"]`);
        await board;
        assert.equal(await p.getAttribute(`.app-project[data-name="${project}"]`, "aria-pressed"), "true");
        assert.equal(asked.at(-1)?.getAll("project").join(), project);
        await boardShows(p, [shown], [hidden]);
      };
      await only(PROJECT.docs, inDocs, inShop);
      await only(PROJECT.shop, inShop, inDocs);
      const all = p.waitForResponse((r) => new URL(r.url()).pathname === "/_p99/api/board");
      await p.click('.app-project[data-name=""]');
      await all;
      assert.deepEqual(asked.at(-1)?.getAll("project"), []);
      await boardShows(p, [inShop, inDocs]);
      await p.keyboard.press("Escape");
      assert.equal(await p.evaluate(() => document.querySelector("p99-root.app-board").shadowRoot.querySelector(".p99-board").hidden), false);
      assert.equal(await screen(p), "board");
    });
  });

  await check("us-page-002 a card opens in the side panel over the board", async () => {
    const ada = await person({ name: "Ada Lovelace", grant: { projects: [PROJECT.docs] }, owner: true });
    const title = `The search finds nothing ${TAG}`;
    await report(DOCS, title, { name: "Grace Hopper", email: email("grace") });
    await visit("/", async ({ p }) => {
      await signIn(p, ada.email, kit.totp(ada.key));
      await boardShown(p);
      await boardShows(p, [title]);
      await p.evaluate((t) => {
        const card = [...document.querySelector("p99-root.app-board").shadowRoot.querySelectorAll(".p99-card")].find((c) => c.textContent.includes(t));
        card.click();
      }, title);
      await p.waitForFunction(() => document.querySelector("p99-root.app-sheet")?.shadowRoot?.querySelector(".p99-panel.is-open [data-view=item]"), null, { timeout: 15000 });
      const sheet = await p.evaluate(() => {
        const r = document.querySelector("p99-root.app-sheet").shadowRoot;
        const x = r.querySelector(".p99-panel .p99-x");
        const box = x.getBoundingClientRect();
        return { title: r.querySelector("#p99-title").textContent, x: [Math.round(box.width), Math.round(box.height)], round: parseFloat(getComputedStyle(x).borderTopLeftRadius) >= 20 };
      });
      assert.deepEqual(sheet, { title, x: [40, 40], round: true });
      await p.keyboard.press("Escape");
      await p.waitForFunction(() => !document.querySelector("p99-root.app-sheet").shadowRoot.querySelector(".p99-panel.is-open"));
      assert.equal(await screen(p), "board");
      assert.equal(await p.evaluate(() => document.querySelector("p99-root.app-board").shadowRoot.querySelector(".p99-board").hidden), false);
    });
  });

  await check("us-page-002 one fixed header stays put on every view and the p99 mark goes home", async () => {
    const ada = await person({ name: "Ada Lovelace", grant: { projects: [PROJECT.shop] }, owner: true });
    const grace = await person({ name: "Grace Hopper", grant: { projects: [PROJECT.shop] } });
    let place = null;
    await visit("/", async ({ p }) => {
      await signIn(p, ada.email, kit.totp(ada.key));
      await boardShown(p);
      const onBoard = await header(p);
      place = onBoard.rect;
      assert.equal(onBoard.position, "fixed");
      assert.equal(onBoard.mark, "#");
      await profile(p);
      const onProfile = await header(p);
      assert.deepEqual(onProfile.rect, place);
      assert.equal(onProfile.position, "fixed");
      assert.equal(onProfile.mark, "#");
      await p.click(".app-bar a.app-mark");
      await boardShown(p);
      assert.deepEqual((await header(p)).rect, place);
    });
    await visit("/", async ({ p }) => {
      await signIn(p, grace.email, kit.totp(grace.key));
      await itemsShown(p);
      assert.deepEqual((await header(p)).rect, place);
      await profile(p);
      assert.deepEqual((await header(p)).rect, place);
      await p.click(".app-bar a.app-mark");
      await itemsShown(p);
      assert.deepEqual((await header(p)).rect, place);
    });
  });

  await check("us-page-002 a space that fails to load says so and try again loads it", async () => {
    const grace = await person({ name: "Grace Hopper", grant: { projects: [PROJECT.shop] } });
    await visit("/", async ({ p, ctx }) => {
      await signIn(p, grace.email, kit.totp(grace.key));
      await itemsShown(p);
      await p.route("**/_p99/app/spaces", (route) => route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"boom"}' }));
      await p.goto(kit.appUrl("/"));
      await waitScreen(p, "problem");
      assert.equal(await p.textContent(".app-problem .app-error"), WORDS.failed);
      await ctx.setOffline(true);
      await p.click(".app-problem button");
      await p.waitForFunction((w) => document.querySelector(".app-problem .app-error")?.textContent === w, WORDS.offline);
      await ctx.setOffline(false);
      await p.unroute("**/_p99/app/spaces");
      await p.click(".app-problem button");
      await itemsShown(p);
    });
  });

  await check("us-page-002 a panel that fails to load says so and try again mounts it once", async () => {
    const grace = await person({ name: "Grace Hopper", grant: { projects: [PROJECT.shop] } });
    await visit("/", async ({ p }) => {
      const isPanel = (url) => url.pathname === "/_p99/panel.js";
      await p.route(isPanel, (route) => route.fulfill({ status: 500, contentType: "text/plain", body: "boom" }));
      await signIn(p, grace.email, kit.totp(grace.key));
      await waitScreen(p, "problem");
      assert.equal(await p.textContent(".app-problem .app-error"), WORDS.failed);
      assert.equal(await p.locator("p99-root").count(), 0);
      await p.unroute(isPanel);
      const loaded = p.waitForResponse((r) => isPanel(new URL(r.url())) && r.status() === 200);
      await p.click(".app-problem button");
      await loaded;
      await itemsShown(p);
      await p.waitForFunction(() => document.querySelectorAll("p99-root").length === 1 && !document.querySelector(".app-wait"));
    });
  });

  await check("us-page-002 a parked code opens nothing and says to ask for a link", async () => {
    const grace = await person({ name: "Grace Hopper", grant: { projects: [PROJECT.shop] } });
    await report(SHOP, `Parked, so unseen ${TAG}`, grace);
    const parked = await signed("PATCH", `/codes/${grace.id}`, { grant: { projects: [] } });
    assert.equal(parked.status, 200, JSON.stringify(parked.json));
    await visit("/", async ({ p }) => {
      await signIn(p, grace.email, kit.totp(grace.key));
      await waitScreen(p, "board");
      assert.equal(await p.textContent(".app-empty"), WORDS.none);
      assert.equal(await p.locator("p99-root").count(), 0);
      assert.equal(await p.locator(".app-project").count(), 0);
    });
  });

  await check("us-page-003 a good username is saved in lower case and shown instead of her email", async () => {
    const grace = await person({ name: "Grace Hopper", grant: { projects: [PROJECT.shop] } });
    const username = `grace.hopper.${TAG}`;
    const key = await report(SHOP, `Assign me ${TAG}`, grace);
    await visit("/", async ({ p }) => {
      await signIn(p, grace.email, kit.totp(grace.key));
      await itemsShown(p);
      await profile(p);
      assert.equal(await p.textContent(".app-profile h1"), "Profile");
      assert.equal(await p.textContent(".app-who b"), grace.name);
      assert.equal(await p.textContent(".app-who span"), grace.email);
      await p.fill(".app-profile input[name=username]", `Grace.Hopper.${TAG.toUpperCase()}`);
      await p.click(".app-profile button[type=submit]");
      await p.waitForFunction(() => document.querySelector(".app-profile > .app-status").textContent === "Saved.");
      assert.equal(await p.inputValue(".app-profile input[name=username]"), username);
      assert.equal(await p.locator(".app-profile input[name=username]").getAttribute("aria-invalid"), null);
      assert.equal(await p.getAttribute(".app-bar .app-me", "data-who"), username);
      assert.equal((await asks(p, "/_p99/api/me")).json.username, username);
    });
    const given = await signed("PATCH", `/issues/${key}?host=${SHOP}`, { assignee: username });
    assert.equal(given.status, 200, JSON.stringify(given.json));
    assert.deepEqual(given.json.assignee, { username, avatar: null });
    assert.equal(JSON.stringify(given.json).includes(grace.email), false);
  });

  await check("us-page-003 a bad or taken username is refused on the page", async () => {
    const holder = await person({ name: "Ada Lovelace", grant: { projects: [PROJECT.shop] } });
    const grace = await person({ name: "Grace Hopper", grant: { projects: [PROJECT.shop] } });
    const held = `taken.${TAG}`;
    const mine = `mine.${TAG}`;
    await visit("/#profile", async ({ p }) => {
      await signIn(p, holder.email, kit.totp(holder.key));
      await waitScreen(p, "profile");
      await p.fill(".app-profile input[name=username]", held);
      await p.click(".app-profile button[type=submit]");
      await p.waitForFunction(() => document.querySelector(".app-profile > .app-status").textContent === "Saved.");
    });
    await visit("/#profile", async ({ p }) => {
      await signIn(p, grace.email, kit.totp(grace.key));
      await waitScreen(p, "profile");
      await p.fill(".app-profile input[name=username]", mine);
      await p.click(".app-profile button[type=submit]");
      await p.waitForFunction(() => document.querySelector(".app-profile > .app-status").textContent === "Saved.");
      await p.fill(".app-profile input[name=username]", "A!");
      await p.click(".app-profile button[type=submit]");
      assert.equal(await p.textContent(".app-profile > .app-status"), WORDS.badName);
      assert.equal(await p.locator(".app-profile input[name=username]").getAttribute("aria-invalid"), "true");
      await p.fill(".app-profile input[name=username]", held);
      await p.click(".app-profile button[type=submit]");
      await p.waitForFunction((w) => document.querySelector(".app-profile > .app-status").textContent === w, WORDS.taken);
      assert.equal(await p.locator(".app-profile input[name=username]").getAttribute("aria-invalid"), "true");
      await p.reload();
      await waitScreen(p, "profile");
      assert.equal(await p.inputValue(".app-profile input[name=username]"), mine);
    });
  });

  await check("us-page-003 a failed save says so and stays on the profile", async () => {
    const grace = await person({ name: "Grace Hopper", grant: { projects: [PROJECT.shop] } });
    const typed = `failed.${TAG}`;
    await visit("/#profile", async ({ p }) => {
      await signIn(p, grace.email, kit.totp(grace.key));
      await waitScreen(p, "profile");
      const isMe = (url) => url.pathname === "/_p99/api/me";
      await p.route(isMe, (route) =>
        route.request().method() === "PATCH" ? route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"no"}' }) : route.continue(),
      );
      await p.fill(".app-profile input[name=username]", typed);
      await p.click(".app-profile button[type=submit]");
      await p.waitForFunction((w) => document.querySelector(".app-profile > .app-status").textContent === w, WORDS.failed);
      assert.equal(await p.locator(".app-profile input[name=username]").getAttribute("aria-invalid"), "true");
      assert.equal(await p.inputValue(".app-profile input[name=username]"), typed);
      assert.equal(await p.locator(".app-profile button[type=submit]").isDisabled(), false);
      assert.equal(await screen(p), "profile");
      await p.unroute(isMe);
      await p.click(".app-profile button[type=submit]");
      await p.waitForFunction(() => document.querySelector(".app-profile > .app-status").textContent === "Saved.");
    });
  });

  await check("us-page-003 esc and the back link leave profile for the space", async () => {
    const grace = await person({ name: "Grace Hopper", grant: { projects: [PROJECT.shop] } });
    await visit("/", async ({ p }) => {
      await signIn(p, grace.email, kit.totp(grace.key));
      await itemsShown(p);
      const place = (await header(p)).rect;
      await profile(p);
      assert.deepEqual((await header(p)).rect, place);
      assert.equal(await p.getAttribute(".app-profile a.app-back", "href"), "#");
      assert.equal(await p.textContent(".app-profile a.app-back"), "Board");
      await p.keyboard.press("Escape");
      await itemsShown(p);
      assert.deepEqual((await header(p)).rect, place);
      await profile(p);
      await p.click(".app-profile a.app-back");
      await itemsShown(p);
      assert.deepEqual((await header(p)).rect, place);
    });
  });

  await check("us-page-004 one sign in reaches the projects of every code she holds", async () => {
    const mail = email("grace");
    const forShop = await person({ name: "Grace Hopper", grant: { projects: [PROJECT.shop] }, mail });
    await person({ name: "Grace Hopper", grant: { projects: [PROJECT.docs] }, mail });
    const inShop = `Grace's shop report ${TAG}`;
    const inDocs = `Grace's docs report ${TAG}`;
    await report(SHOP, inShop, forShop);
    await report(DOCS, inDocs, forShop);
    await visit("/", async ({ p }) => {
      await signIn(p, mail, kit.totp(forShop.key));
      await itemsShown(p);
      const chips = await p.locator(".app-project").evaluateAll((list) => list.map((b) => b.dataset.name));
      assert.deepEqual(chips.slice().sort(), ["", PROJECT.docs, PROJECT.shop]);
      await p.click(`.app-project[data-name="${PROJECT.shop}"]`);
      await listShows(p, [inShop], [inDocs]);
      await p.click(`.app-project[data-name="${PROJECT.docs}"]`);
      await listShows(p, [inDocs], [inShop]);
      await p.waitForFunction(() => document.querySelectorAll("p99-root").length === 1);
    });
  });

  await check("us-page-004 a project with no site yet still opens its board", async () => {
    const katherine = await person({ name: "Katherine Johnson", grant: { projects: [PROJECT.ops] }, owner: true });
    const title = `Rotate the keys ${TAG}`;
    const card = await signed("POST", "/cards", { client_uid: randomUUID(), project: PROJECT.ops, title });
    assert.equal(card.status, 201, JSON.stringify(card.json));
    await visit("/", async ({ p, errors }) => {
      const asked = [];
      p.on("request", (r) => {
        const u = new URL(r.url());
        if (["/_p99/api/space", "/_p99/api/me", "/_p99/api/board"].includes(u.pathname)) asked.push([u.pathname, u.searchParams.has("host")]);
      });
      await signIn(p, katherine.email, kit.totp(katherine.key));
      await boardShown(p);
      await boardShows(p, [title]);
      const chips = await p.locator(".app-project").evaluateAll((list) => list.map((b) => [b.dataset.name, b.querySelector(".app-hosts")?.textContent ?? null]));
      assert.deepEqual(chips, [["", null], [PROJECT.ops, "No sites"]]);
      for (const path of ["/_p99/api/space", "/_p99/api/me", "/_p99/api/board"]) assert.ok(asked.some(([seen]) => seen === path), `${path} was never asked`);
      assert.deepEqual(asked.filter(([, host]) => host), []);
      assert.deepEqual(errors, []);
    });
  });

  const picked = async (p, who, owns = false) => {
    await signIn(p, who.email, kit.totp(who.key));
    await (owns ? boardShown(p) : itemsShown(p));
    await profile(p);
  };

  const pick = async (p, name, type, buffer) => {
    await p.setInputFiles(".app-picture input[type=file]", { name, mimeType: type, buffer });
  };

  await check("us-page-005 a wide picture is cropped square stored at 256 and shown at once", async () => {
    const grace = await person({ name: "Grace Hopper", grant: { projects: [PROJECT.shop] } });
    await visit("/", async ({ p }) => {
      await picked(p, grace);
      assert.equal((await asks(p, "/_p99/api/me")).json.avatar, null);
      await pick(p, "wide.png", "image/png", await picturePng(p, 400, 200));
      await p.waitForFunction((w) => document.querySelector(".app-picture .app-status")?.textContent === w, WORDS.pictureSaved);
      const me = (await asks(p, "/_p99/api/me")).json;
      assert.match(me.avatar, new RegExp(`^/_p99/api/avatars/${me.username}\\?v=`));
      const kept = await p.evaluate(async (url) => {
        const r = await fetch(url, { headers: { "X-P99-App": "1" }, credentials: "same-origin" });
        const blob = await r.blob();
        const bmp = await createImageBitmap(blob);
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext("2d");
        g.drawImage(bmp, 0, 0);
        return { status: r.status, type: r.headers.get("content-type"), bytes: blob.size, w: bmp.width, h: bmp.height, corner: Array.from(g.getImageData(2, 2, 1, 1).data.slice(0, 3)) };
      }, me.avatar);
      assert.equal(kept.status, 200);
      assert.match(kept.type, /^image\/(webp|jpeg|png)$/);
      assert.ok(kept.bytes <= 256 * 1024, String(kept.bytes));
      assert.deepEqual([kept.w, kept.h], [256, 256]);
      assert.ok(kept.corner[2] > 200 && kept.corner[0] < 60, `the square is cut from the middle, so its corner is the blue centre, not the red sides (${kept.corner})`);
      await p.waitForFunction(() => /^blob:/.test(document.querySelector(".app-bar .app-me img")?.src || "") && /^blob:/.test(document.querySelector(".app-face img")?.src || ""));
      assert.equal(await p.locator(".app-picture .app-unpick").isHidden(), false);
    });
  });

  await check("us-page-005 removing the picture brings the pattern back", async () => {
    const grace = await person({ name: "Grace Hopper", grant: { projects: [PROJECT.shop] } });
    await visit("/", async ({ p }) => {
      await picked(p, grace);
      await pick(p, "wide.png", "image/png", await picturePng(p, 300, 300));
      await p.waitForFunction((w) => document.querySelector(".app-picture .app-status")?.textContent === w, WORDS.pictureSaved);
      const url = (await asks(p, "/_p99/api/me")).json.avatar;
      assert.equal((await asks(p, url)).status, 200);
      await p.click(".app-picture .app-unpick");
      await p.waitForFunction((w) => document.querySelector(".app-picture .app-status")?.textContent === w, WORDS.pictureRemoved);
      await p.waitForFunction(() => /^data:image\/svg/.test(document.querySelector(".app-face img")?.src || "") && document.querySelector(".app-picture .app-unpick").hidden);
      assert.equal((await asks(p, "/_p99/api/me")).json.avatar, null);
      assert.equal((await asks(p, url)).status, 404);
    });
  });

  await check("us-page-005 a file that is not a picture is refused and nothing is sent", async () => {
    const grace = await person({ name: "Grace Hopper", grant: { projects: [PROJECT.shop] } });
    await visit("/", async ({ p }) => {
      await picked(p, grace);
      const sent = [];
      p.on("request", (r) => {
        if (new URL(r.url()).pathname === "/_p99/api/me/avatar") sent.push(r.method());
      });
      await pick(p, "notes.png", "image/png", Buffer.from("not a picture"));
      await p.waitForFunction((w) => document.querySelector(".app-picture .app-status")?.textContent === w, WORDS.pictureBad);
      assert.deepEqual(sent, []);
      assert.equal((await asks(p, "/_p99/api/me")).json.avatar, null);
      assert.equal(await p.locator(".app-picture .app-unpick").isHidden(), true);
    });
  });

  const owner = (name = "Ada Lovelace") => person({ name, grant: { projects: [PROJECT.shop] }, owner: true });
  const badgeOf = (p) => p.getAttribute(".app-bar .app-pill img", "src");

  await check("us-page-006 an owner pastes a good key and the badge changes at once", async () => {
    const ada = await owner();
    const key = kit.licenceKey({ tier: "agency", paid_through: "2099-12-31" });
    try {
      await visit("/", async ({ p }) => {
        await picked(p, ada, true);
        assert.equal(await p.locator(".app-licence textarea[name=licence]").count(), 1);
        assert.equal(await p.locator(".app-licence .app-quiet").isHidden(), true);
        await p.fill(".app-licence textarea[name=licence]", `  ${key}\n`);
        await p.click(".app-licence button[type=submit]");
        await p.waitForFunction((w) => document.querySelector(".app-licence .app-status").textContent === w, WORDS.licenceSaved);
        assert.match(await badgeOf(p), /^\/_p99\/badges\/agency\.svg\?v=/);
        assert.equal(await p.inputValue(".app-licence textarea"), "");
        assert.equal(await p.locator(".app-licence .app-quiet").isHidden(), false);
        assert.deepEqual(await licenceOf(p), { state: "agency", link: "hideable", stored: true });
      });
    } finally {
      await signed("DELETE", "/licence");
    }
  });

  await check("us-page-006 a bad key is named and the badge stays", async () => {
    const ada = await owner();
    await visit("/", async ({ p }) => {
      await picked(p, ada, true);
      const before = await licenceOf(p);
      await p.click(".app-licence button[type=submit]");
      assert.equal(await p.textContent(".app-licence .app-status"), WORDS.licenceEmpty);
      await p.fill(".app-licence textarea[name=licence]", "not a key");
      await p.click(".app-licence button[type=submit]");
      await p.waitForFunction((w) => document.querySelector(".app-licence .app-status").textContent === w, "that is not a PITO MD licence key");
      assert.equal(await p.getAttribute(".app-licence textarea", "aria-invalid"), "true");
      assert.match(await badgeOf(p), new RegExp(`^/_p99/badges/${before.state}\\.svg`));
      assert.equal(await p.locator(".app-licence .app-quiet").isHidden(), true);
      assert.deepEqual(await licenceOf(p), before);
      assert.equal(before.stored, false);
    });
  });

  await check("us-page-006 remove puts back the licence the space had before", async () => {
    const ada = await owner();
    const key = kit.licenceKey({ tier: "studio", paid_through: "2099-12-31" });
    try {
      await visit("/", async ({ p }) => {
        await picked(p, ada, true);
        const before = await licenceOf(p);
        await p.fill(".app-licence textarea[name=licence]", key);
        await p.click(".app-licence button[type=submit]");
        await p.waitForFunction((w) => document.querySelector(".app-licence .app-status").textContent === w, WORDS.licenceSaved);
        assert.match(await badgeOf(p), /^\/_p99\/badges\/studio\.svg\?v=/);
        await p.click(".app-licence .app-quiet");
        const said = before.state === "free" ? "Removed. This space is on Free." : `Removed. This space still has ${BADGES[before.state]} from its own setup.`;
        await p.waitForFunction((w) => document.querySelector(".app-licence .app-status").textContent === w, said);
        assert.match(await badgeOf(p), new RegExp(`^/_p99/badges/${before.state}\\.svg\\?v=`));
        assert.equal(await p.locator(".app-licence .app-quiet").isHidden(), true);
        assert.deepEqual(await licenceOf(p), before);
      });
    } finally {
      await signed("DELETE", "/licence");
    }
  });

  await check("us-page-006 a user sees no licence field and cannot set one", async () => {
    const grace = await person({ name: "Grace Hopper", grant: { projects: [PROJECT.shop] } });
    const key = kit.licenceKey({ tier: "agency", paid_through: "2099-12-31" });
    await visit("/", async ({ p }) => {
      await picked(p, grace);
      assert.equal(await p.locator(".app-licence").count(), 0);
      const before = await licenceOf(p);
      const refused = await asks(p, "/_p99/api/licence", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
      assert.equal(refused.status, 403, JSON.stringify(refused.json));
      assert.deepEqual(await licenceOf(p), before);
      assert.equal(before.stored, false);
    });
  });
}
