# Putting P99 on a site

## The tag

One tag in the shared `<head>` of every page:

```html
<script src="/_p99/p99.js" async></script>
```

With a nonce-based Content-Security-Policy, give it the page's nonce. Nothing else goes in the page: the button's corner, offset, theme and the pages P99 stays off come from the host's config, which the Worker writes into the loader it serves for that host.

Shipping the tag before the Worker's route exists is harmless: the script fails to load and nothing is drawn.

## The route

`p99 setup` (or `p99 hosts add`) adds the Worker route `<host>/_p99/*` on the host's zone. A route runs before whatever else serves the host, a Pages project, a tunnel or another Worker on a Custom Domain, so P99 sits in front of them for that one path and never touches them. Setup adds only the route: an existing Custom Domain, Worker or Pages project on the host is detected, named and left as it is.

A host behind Cloudflare Access keeps `/_p99/*` behind Access: the browser already carries the Access cookie, so the page's requests pass. The CLI, the TUI and `p99 announce` carry no cookie, so give them one of two ways in. Either point the account's `url` at a host or a custom domain of the Worker that is not behind Access: the signed API answers on any address the Worker is mounted on, naming the host it means with `?host=`. Or create an Access service token for the application and set the account's `access_client_id` and `access_client_secret` (docs/config.md): every request then carries `CF-Access-Client-Id` and `CF-Access-Client-Secret`. Either way, P99's own signature still guards every request.

## Content-Security-Policy

P99 works under a strict policy such as `default-src 'none'; script-src 'nonce-…' https://<host>/_p99/; connect-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'`. Its styles need nothing in `style-src`, not even `'unsafe-inline'`:

- It loads scripts only from `/_p99/`: `p99.js`, then on the first click `panel.js` and, when a capture is taken, `capture.js`, all by `import()` or the tag. Allow the `https://<host>/_p99/` path in `script-src`.
- It styles its Shadow DOM only through constructable stylesheets (`adoptedStyleSheets`): the loader builds its own, and the panel fetches `/_p99/p99.css` with `fetch` and loads it the same way. It never inserts a `<style>` or `<link>`, never writes a `style="…"` attribute, and sets positions and theme values through the CSSOM.
- It fetches only same-origin URLs: the `/_p99/` API and files, and, while a capture is taken, the page's own same-origin images and web fonts. Its images are `/_p99/art/*.svg` and `data:` captures.
- It uses no inline handlers, no `eval` or `new Function`, no workers, no frames and nothing from another origin. Captures draw the page through a `data:` SVG into a canvas; a cross-origin image, background or font is never fetched and is left blank, and a cross-origin video is drawn as its same-origin poster or left blank, so a host needs no `crossorigin` attributes.
- It adds one element to the page (its Shadow DOM host) and one global, `P99`.

## Privacy

- A page's address is recorded without its query string and hash. Page text is read only from regions the person marks, and never from elements marked `data-p99-redact`, which are blanked in every capture; `data-p99-ignore` leaves an element out of captures altogether.
- P99 stays off on pages that carry `<meta name="p99" content="off">` and on paths the host's config lists in `off` (patterns such as `/checkout/*/done`): there the loader draws nothing, reads nothing and captures nothing.
- A personal code is read from `?p99=<code>` once, kept in the site's `localStorage` and removed from the address bar at once.
- The panel never locks the page's scroll; it scrolls inside itself.

## Host config

`p99 hosts add <host> --env <env>` and the `[hosts."<host>"]` table in the config set:

| Key | Meaning |
| --- | --- |
| `corner` | `bottom-right` (default), `bottom-left`, `top-right` or `top-left` |
| `offset` | `{ x = 16, y = 16 }`, pixels from the corner's two edges |
| `above` | a CSS selector; while that element is visible the button sits above it |
| `off` | path patterns (`*` matches one segment, `**` any) where P99 never loads |
| `theme` | `--p99-*` custom properties without their prefix, `{ accent = "#3b7dd8" }`; a `dark` table inside it holds the dark-mode values, `{ dark = { base = "#1f2c3c" } }` |
| `strings` | any of the panel's English words, by key |

## Environments

A host has one environment. A site with a production and a development address makes them two hosts in one account, each with its own environment (`production` as `release`, `dev` as `development`), so their items stay apart and share one numbering.

## Cloudflare limits

P99 keeps its state in D1 and R2 and never writes to KV. Its rate-limiting binding takes a `namespace_id` that `p99 setup` picks from the ones no other Worker in the account uses.
