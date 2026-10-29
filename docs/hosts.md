# Putting P99 on a site

## The tag

One tag in the shared `<head>` of every page:

```html
<script src="/_p99/p99.js" async></script>
```

With a nonce-based Content-Security-Policy, give it the page's nonce. Nothing else goes in the page: the button's corner, offset, theme and the pages P99 stays off come from the host's config, which the Worker writes into the loader it serves for that host.

Shipping the tag before the Worker's route exists is harmless: the script fails to load and nothing is drawn.

P99 survives body swaps, so sites that navigate by replacing the body (htmx with `hx-boost`, Turbo, Swup, Barba) need nothing more. When a swap drops the button, the loader puts the same element back with its panel and state intact. On every path change it checks the `off` patterns and the `off` meta again, hiding the button on an off page and bringing it back on the next page that isn't, and it refreshes the page's counts once. The `above` element is looked up again when a swap replaces it. It counts only while it is shown: not hidden, transparent or zero-sized. A `#p99=<KEY>` link followed after a swap opens the card as usual.

## The route

`p99 setup` (or `p99 hosts add`) adds the Worker route `<host>/_p99/*` on the host's zone. A route runs before whatever else serves the host, a Pages project, a tunnel or another Worker on a Custom Domain, so P99 sits in front of them for that one path and never touches them. Setup adds only the route: an existing Custom Domain, Worker or Pages project on the host is detected, named and left as it is.

A host behind Cloudflare Access keeps `/_p99/*` behind Access: the browser already carries the Access cookie, so the page's requests pass. The CLI, the TUI and `p99 announce` carry no cookie. They reach the Worker through any host of the space (the one a command names first, then the `production` hosts, then the rest), skip a host that answers with Access's login, and keep using the one that answered, so a space with one host outside Access needs nothing more. When every host is behind Access, give them one of two ways in. Either point the space's `url` at a host or a custom domain of the Worker that is not behind Access: the signed API answers on any address the Worker is mounted on, naming the host it means with `?host=`. Or create an Access service token for the application and set the space's `access_client_id` and `access_client_secret` (docs/config.md): every request then carries `CF-Access-Client-Id` and `CF-Access-Client-Secret`. Either way, P99's own signature still guards every request.

## Content-Security-Policy

P99 works under a strict policy such as `default-src 'none'; script-src 'nonce-…' https://<host>/_p99/; connect-src 'self'; style-src 'self'; img-src 'self'; frame-src 'self'; font-src 'self'; frame-ancestors 'none'`, and under `default-src 'self'` alone. Its styles need nothing in `style-src`, not even `'unsafe-inline'`, and its images nothing beyond `'self'`:

- It loads scripts only from `/_p99/`: `p99.js`, then on the first click `panel.js` and, when a capture is taken, `capture.js`, all by `import()` or the tag. Allow the `https://<host>/_p99/` path in `script-src`.
- It styles its Shadow DOM only through constructable stylesheets (`adoptedStyleSheets`): the loader builds its own, and the panel fetches `/_p99/p99.css` with `fetch` and loads it the same way. It never inserts a `<style>` or `<link>`, never writes a `style="…"` attribute, and sets positions and theme values through the CSSOM.
- It fetches only same-origin URLs: the `/_p99/` API and files, and, while a capture is taken, the page's own same-origin images and web fonts. Its only image URLs are `/_p99/art/*.svg` and `/_p99/badges/*.svg`; previews, attachments and avatars are drawn into canvases and inline SVG, never loaded from `data:` or `blob:`.
- It uses no inline handlers, no `eval` or `new Function`, no workers and nothing from another origin. Captures draw the page through an SVG into a canvas. That SVG is decoded in one hidden frame, `/_p99/frame.html`, served by the Worker on the same host with its own policy (`default-src 'none'; img-src data:; frame-ancestors 'self'`), so the page's `img-src` needs no `data:`; it needs `'self'` in `frame-src` (or `child-src`, or `default-src`). Where a policy bars that frame but allows `img-src data:`, the capture decodes in the page instead, and the browser remembers which works. Where it allows neither, the form says the site's security settings block the screenshot and the card goes without one. A cross-origin image, background or font is never fetched and is left blank, and a cross-origin video is drawn as its same-origin poster or left blank, so a host needs no `crossorigin` attributes.
- It adds one element to the page (its Shadow DOM host) and one global, `P99`.

## Privacy

- A page's address is recorded without its query string and hash. Page text is read only from regions the person marks, and never from elements marked `data-p99-redact` or matching the host's `mask` selectors; those, everything inside them and password fields are painted over as solid blocks in the theme's colour before a capture leaves the browser. When the page has such an area, the form shows "Hide this site's private areas", checked; the person filing can uncheck it to send those areas as they are, and the preview shows exactly what goes. Password fields and what was typed inside those areas stay blanked either way, and their text still stays out of marked regions. With `capture = "off"` the panel sends no image at all; `data-p99-ignore` leaves an element out of captures altogether.
- P99 stays off on pages that carry `<meta name="p99" content="off">` and on paths the host's config lists in `off` (patterns such as `/checkout/*/done`): there the loader draws nothing, reads nothing and captures nothing.
- A personal code comes in the link's fragment, `https://<host>/#p99=<code>`, which browsers never send to a server, so it stays out of your server's, Cloudflare's and any analytics' logs and `Referer` headers. The loader keeps it in the site's `localStorage` and removes it from the address bar and the history entry at once; it reads the address the browser opened, so a site script that rewrites the hash before the loader runs doesn't lose it. A code the Worker refuses shows one short, dismissable line by the button instead of nothing. Treat the link as the secret it is.
- With each card the panel sends the page's address without its query or hash, its title, the browser and its version, the device's platform and model, the window and screen size, zoom and scroll, the colour-scheme and motion preferences, languages and time zone, the connection type and speed, the number of cores, memory and touch points, the page's load timings, and its last 20 script error messages with any query or hash cut from them.
- The panel never locks the page's scroll; it scrolls inside itself.

## Host config

`p99 hosts add <host> --project <name> --env <env>` and the `[hosts."<host>"]` table in the config set:

| Key | Meaning |
| --- | --- |
| `corner` | `bottom-right` (default), `bottom-left`, `top-right` or `top-left` |
| `offset` | `{ x = 16, y = 16 }`, pixels from the corner's two edges |
| `above` | a CSS selector; while that element is visible the button sits above it |
| `off` | path patterns (`*` matches one segment, `**` any) where P99 never loads |
| `theme` | `--p99-*` custom properties without their prefix, `{ accent = "#3b7dd8" }`; a `dark` table inside it holds the dark-mode values, `{ dark = { base = "#1f2c3c" } }`; the P99 logo in the panel's head keeps its own colours and font. The page's "+" button takes the `accent`; in dark mode it falls back to P99's light blue (#8db8f0) unless the accent is a `#rgb` or `#rrggbb` colour that reaches 3:1 against the button |
| `strings` | any of the panel's English words, by key |
| `mask` | CSS selectors the panel blanks in every capture, besides anything marked `data-p99-redact`, unless the person filing unchecks "Hide this site's private areas"; at most 50, each at most 200 characters (`p99 hosts set <host> --mask '<selector>'`, repeated; `--mask none` clears them). The Worker refuses a selector that does not parse and says so |
| `capture` | `on` (the default) or `off`: with `off` the panel files the card with its text and no screenshot, and says so (`p99 hosts set <host> --capture off`) |
| `feed` | `true` serves the host's feed of fixed cards at `/_p99/feed` (`p99 feed on <host>`); off by default |
| `link` | `false` hides the small "by PITO.MD" link in the panel's head (`p99 hosts set <host> --pitomd-link off`, and `on` shows it again); only an Agency key may hide it, so with any other key the link shows whatever this says; `off` takes hold once a `p99 deploy` has run with that key. The same head shows the space's licence badge to everyone with a code |

## Slack and Discord

A host can post to a Slack channel, a Discord channel or both, through an incoming webhook made in Slack or Discord; there is no app to install and no OAuth.

```sh
p99 hooks set example.com --slack https://hooks.slack.com/services/T…/B…/…
p99 hooks set example.com --url-ref env:SLACK_WEBHOOK --on new,status
p99 hooks
p99 hooks test example.com
p99 hooks remove example.com --discord
```

- `--on` picks what is posted, from `new` (a card is filed), `comment` (a comment that is not an internal note), `status` (a card changes column) and `shipped` (`p99 announce` lands its fix in a `release` environment); a new hook posts all four, and setting a hook again without `--on` keeps its list.
- `--url-ref` reads the URL from an environment variable (`env:NAME`), a file only you can read (`file:PATH`) or a command that prints it (`command:WORDS`), so it never sits in the shell's history; with it, the URL itself says whether it is Slack or Discord.
- Only `https://hooks.slack.com/services/…` and `https://discord.com/api/webhooks/…` (or `discordapp.com`) URLs are taken. The Worker keeps each one encrypted and never shows it again: `p99 hooks` shows its last four characters, its events and how the last post went.
- A post names the card's key, kind, title and label, who acted (an agent as `Ada Lovelace 🤖`) and a link that opens the card in the panel on the site. It never carries an e-mail address, an internal note or an attachment.
- Posts go out after the Worker has answered, with a 5-second limit; a webhook that fails or hangs never fails or slows the change, and its answer shows in `p99 hooks`. A request that changes many cards (a board moved to another column) posts one message per hook, listing up to ten of them.

## Environments

A host has one environment. A site with a production and a development address makes them two hosts in one space, each with its own environment (`production` as `release`, `dev` as `development`), so their cards stay apart and share one numbering.

## Cloudflare limits

P99 keeps its state in D1 and R2 and never writes to KV. Its rate-limiting binding takes a `namespace_id` that `p99 setup` picks from the ones no other Worker in the space uses.
