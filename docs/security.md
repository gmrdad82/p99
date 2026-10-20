# Security of the P99 page

The P99 page is the account's own address (`p99 app` prints it), where a person signs in with their e-mail and an authenticator code and reaches the panel of every site their codes cover. This page lists what it defends against and how. The sites' panel and the signed API are unchanged by it.

## Sign-in

- **Who can sign in.** Only a live code with an authenticator (TOTP) signs in, with the e-mail it was minted for and the current 6-digit code. There are no passwords and no mailed links. Agents have no sign-in; they use the CLI's signed key.
- **Guessing codes.** Tries are counted in D1 per e-mail (5 in 15 minutes) and per client address (30 in 15 minutes; an IPv6 address counts by its /64), before any lookup, and 10 wrong codes in a row lock that authenticator, on the sites and on the page alike, until a manager sets it up again (`p99 invites totp <id>`). D1 rather than the `RATE` binding: the counts are exact across Cloudflare's locations and survive a restart, and the binding stays for the per-code request limit. Someone who knows an e-mail can spend that person's tries and, slowly, lock their authenticator; already-trusted browsers on the sites keep working, and a manager can reset it.
- **Telling people apart.** An unknown e-mail, a code without an authenticator, a locked one and a wrong code get the same 401 with the same words. Each runs the same steps (one lookup, the authenticator check against a stand-in key when there is none, one update), so their timing is alike.
- **Replay.** A 30-second step that has signed in once, here or on a site, can't sign in again: the step is claimed in the same statement that opens the session.
- **Compares.** The 6-digit code is compared in constant time. Session tokens are looked up by their keyed hash, never compared as text.

## Session

- An opaque 256-bit random token in the cookie `__Host-p99`: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, 30 days. Only its HMAC (keyed with the Worker's `CODE_PEPPER`) is stored, so the database alone can't sign anyone in.
- Each sign-in makes a new token and deletes the one the browser held; sign-out deletes it on the server and clears the cookie.
- It ends the moment the code it signed in with is revoked or relinked (every request checks), and when that code's authenticator is set up again.
- A space is reached with the person's live code for that host, with that code's hosts and role, exactly as on the site; a host the codes don't cover answers 404. Nothing the browser sends picks the code or the role.

## Cross-site requests

- Every request to the page's API carries the header `X-P99-App: 1`, which another site can't send without a CORS preflight the Worker never grants, and every state change must come with an `Origin` equal to the page's own. With a `SameSite=Strict` cookie that is enough, so there are no CSRF tokens.
- The live board's WebSocket can't carry a header; it uses the same one-time, 30-second ticket as on the sites, minted through the API above.

## Content-Security-Policy and headers

The page and its files are served with:

```text
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'sha256-…'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Frame-Options: DENY
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Strict-Transport-Security: max-age=31536000
```

The page has no inline script and one inline `<style>` block: the small style its first paint needs (the colours, the layout, the sign-in card and the loading shimmer), allowed by its own `'sha256-…'` hash and nothing else, so `'unsafe-inline'` stays out. The rest of the style, `app.css`, loads without holding up that paint. The worker suite checks that the hash in the header is the hash of the block as served (`npm run test:csp` runs that check alone). Its own files (`app.js`, `app.css`) are served only on the page's address, and the sites' loader is not served there. Uploaded files keep their own `default-src 'none'; sandbox` policy.

## Same host as the CLI

When `app` names the host the CLI's `url` reaches, the signed API (`/_p99/v1/*`) keeps answering there, and only to signed requests; the page's session never reaches it.
