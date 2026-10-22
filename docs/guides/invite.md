---
title: Invite people
description: Mint personal codes with p99 invite, mail their links, renew one with p99 relink, list who holds one and revoke a code.
sidebar:
  order: 3
---

![The codes screen of p99 tui: who can file on which hosts, active and revoked](../images/codes.png)

P99 has no accounts and no sign-up. Each person you invite gets a **personal code**, 12 characters, for one or more hosts of one account. The "+" shows only in a browser that holds a code; everyone else sees nothing.

## Mint a code

```sh
p99 invite example.com shop.example.com --name "Grace Hopper" --email grace@example.com
```

```text
Grace Hopper <grace@example.com>
secret: <code>
link:   https://example.com/#p99=<code>
link:   https://shop.example.com/#p99=<code>
this is the only time the secret is shown
```

That is the output when mail is off or you invite yourself; with mail on, the person gets the link by mail instead (see [Access links](#access-links)). In place of `<code>` it prints the 12 characters of the new code. Send the person a link. They open it once: the page keeps the code in the site's `localStorage` and removes it from the address bar and the history entry at once. The loader reads the link as the browser opened it, so a site script that rewrites the hash first doesn't lose the code, and it takes `#P99=` in capitals or a link that an app ended with a full stop. A code the Worker refuses (mistyped, revoked, or not for this host) shows one short line by the button, "This P99 link isn't valid here. Ask for a new one.", in place of the button; its × closes it, and the site forgets the code. If P99 is busy when the link opens (it answers too many requests or a server error), the panel opens on its own with "Signing you in" and one line, "P99 is busy, trying again in 5s", counting down. It tries again after 1, 2, 4 and 8 seconds, then every 30 seconds, only while the tab is in view, and closes the moment the person is signed in. The code stays in the browser the whole time, so they never need the link again. The code sits in the link's fragment, which the browser never sends to a server, so it stays out of your server's, Cloudflare's and any analytics' logs and `Referer` headers. Treat the link as the secret it is. P99 keeps only the code's SHA-256, so a lost secret can't be shown again: mint a new code.

`--json` prints the code object, the secret, the links and `mail` (`sent`, `off`, `failed` or `skipped`, when mail was asked), for a script that sends the invitations.

## Access links

With mail on for the account (`p99 email set`, in [Set up P99](setup.md)), `p99 invite` mails the person their link through the account's mail provider:

```text
Grace Hopper <grace@example.com>
mailed the link for example.com, shop.example.com to grace@example.com
```

The mail has one "Open P99 on <host>" button for each host the code covers, sized for a phone, and its plain-text part lists each link as `https://<host>/#p99=<code>`. Replies go to the e-mail of whoever sent the invite. The authenticator key of a `--totp` code is never in the mail: the terminal prints it, for you to send apart. Add `--no-mail` to print the links in the terminal instead. When the account has no mail, or the mail doesn't go out, the terminal prints the links once with one line that says so.

Your own links never go by mail: inviting the e-mail in your config's `[me]` prints them in the terminal, one line per host, and `--mail-me` also mails them to you. P99 writes them nowhere, so save them in your password manager if you keep them there.

### Renew a link

```sh
p99 relink 3
p99 relink grace@example.com
p99 relink grace@example.com --host shop.example.com
p99 relink --self
```

`p99 relink` mints a new code for the same person, with the same name, e-mail, hosts and role, and revokes the old one in the same request, so there is no moment when both work or neither does. It mails the new link as `p99 invite` does (with `--no-mail` and `--mail-me` the same way), and the old link answers 401 from then on. Name the code by its id from `p99 invites`, or by the person's e-mail when they hold one code; `--host` picks the code that covers that host, and `--self` takes your own e-mail from the config. Items, comments and history follow the e-mail, so nothing is lost. A code with an authenticator keeps it: the new code gets the same secret, still encrypted in the Worker, so the person's app keeps giving the right 6-digit codes; each browser asks for one again, once. `--new-totp` gives the new code a new authenticator and prints its setup.

### Open your own link

```sh
p99 link
p99 link shop.example.com
p99 link shop.example.com --print
```

`p99 link` opens your link in the default browser, built from the `code` your config keeps for the account: the 12 characters inline (the config file at mode 600), or an `op://vault/item/field` reference that P99 reads through the 1Password CLI at that moment, as it reads a token or a key. P99 only reads it and never writes it there:

```toml
[accounts.main]
code = "op://vault/item/field"
```

With several hosts and none named, it asks which one in a terminal and lists them otherwise. `--print` prints the link instead of opening it; `P99_BROWSER` names another program to open it with.

## Members and managers

A code holder files bugs, ideas, improvements and questions, and sees and follows only what they reported. Add `--manager` to let the person see and change every item, file tasks and write internal comments:

```sh
p99 invite example.com --name "Ada Lovelace" --email ada@example.com --manager
```

The e-mail you gave `p99 setup` is a manager from the start: it is in the Worker's `MANAGERS` secret, and so is anyone you add there.

Each code is limited to 120 requests a minute, and a member to 30 items, 200 comments and 100 MiB of files a day. Managers have no daily limits.

## See who holds a code

```sh
p99 invites
p99 invites --host shop.example.com
```

```text
   1  active  Ada Lovelace <ada@example.com>  manager  ...7k2q  2026-09-14 12:00  hosts: example.com, shop.example.com  last used: 2026-10-14 11:48
   2  revoked  Grace Hopper <grace@example.com>  member  ...3fpd  2026-09-19 12:00  hosts: shop.example.com  last used: 2026-09-22 12:00
   3  active  Grace Hopper <grace@example.com>  member  ...m9xa  2026-09-23 12:00  hosts: example.com, shop.example.com  last used: 2026-10-14 11:48
```

Each line is the code's id, its state, the person, the role, the secret's last four characters, when it was made, its hosts and when it was last used. In `p99 tui`, `tab` switches to the same list on the Codes screen, with `/` to filter it.

## Revoke a code

```sh
p99 revoke 3
```

```text
revoked code 3 of Grace Hopper <grace@example.com>
```

The next request with that code answers 401, and the loader forgets it, so the "+" disappears from that browser. The person's items and comments stay. To give someone a new code in place of the old one, use `p99 relink`; a code can't be changed or shown again. With an authenticator on the code, a forwarded link alone opens nothing in another browser, so revoking is for a link you want gone, or a person who should no longer file.

## Add an authenticator

A code can ask for a 6-digit code from an authenticator app the first time each browser uses it. Mint it that way with `--totp`, or add an authenticator to a code someone already holds, keeping their link:

```sh
p99 invite example.com --name "Grace Hopper" --email grace@example.com --totp
p99 invites totp 3
```

```text
key:    <32 base32 characters>   (paste it as a one-time password or setup key; totp is the same as a link)
totp:   otpauth://totp/P99:grace@example.com?secret=<32 base32 characters>&issuer=P99&algorithm=SHA1&digits=6&period=30
```

Both lines carry the same secret, shown this once. Paste the key: in 1Password as an item's One-Time Password field, in Bitwarden or Apple Passwords as the authenticator key, in Google Authenticator or Authy under "enter a setup key". The `otpauth://` line is for apps that take a setup link; if an app shows codes P99 refuses, set it up from the key instead. Send both apart from the link, so one forwarded message never carries both.

The first time a browser opens the link, the panel opens on its own and asks for the 6-digit code; after that the browser is remembered. Another browser, or one whose site data was cleared, asks again. After 10 wrong codes the authenticator locks; `p99 invites totp <id>` sets a new one, which also makes every browser of that code ask again, so it is the way to recover a lost phone too. `p99 invites` marks such codes `totp`.

## Move a person to a new e-mail

```sh
p99 people rename grace@example.com grace.hopper@example.org
```

```text
moved grace@example.com to grace.hopper@example.org: 2 items, 0 assigned, 1 comments, 3 events, 0 attachments, 1 codes
```

Everything under the old e-mail moves in one transaction on the whole account: items, assignments, comments, events, attachments and codes, with their authenticators and links unchanged. Set the new e-mail in your config's `[me]` too, so your own new work lands under it.

## Next

[Work the inbox](inbox.md): read and answer what people file.
