---
title: Invite people
description: Mint personal codes with p99 invite, mail their links, renew one with p99 relink, list who holds one and revoke a code.
sidebar:
  order: 3
---

![The codes screen of p99 tui: who can file on which hosts, active and revoked](../images/codes.png)

P99 has no passwords and no sign-up. Each person you invite gets a **personal code**, 12 characters, that grants either the whole space or some of its projects. A code never names hosts: it reaches every host of a project it grants, so a host added to a project reaches everyone who holds that project at once. The "+" shows only in a browser that holds a code; everyone else sees nothing.

## Mint a code

```sh
p99 invite --project Shop --project Blog --name "Grace Hopper" --email grace@example.com
```

`--space` alone grants the whole space; `--project` repeats, and with `--space <slug>` names which space when the config has several. Without a space named, P99 uses the one that holds the projects. `--space <slug>` with no `--project` grants that whole space too, and P99 says so before it sends anything. A host list in place of the grant (`p99 invite example.com …`) still works: P99 grants the projects those hosts are in and says so.

```text
Grace Hopper <grace@example.com>
secret: <code>
link:   https://example.com/#p99=<code>
link:   https://shop.example.com/#p99=<code>
this is the only time the secret is shown
```

That is the output when mail is off or you invite yourself; with mail on, the person gets the link by mail instead (see [Access links](#access-links)). In place of `<code>` it prints the 12 characters of the new code. Send the person a link. They open it once: the page keeps the code in the site's `localStorage` and removes it from the address bar and the history entry at once. The loader reads the link as the browser opened it, so a site script that rewrites the hash first doesn't lose the code, and it takes `#P99=` in capitals or a link that an app ended with a full stop. A code the Worker refuses (mistyped, revoked, or not for this host) shows one short line by the button, "This P99 link isn't valid here. Ask for a new one.", in place of the button; its × closes it, and the site forgets the code. If P99 is busy when the link opens (it answers too many requests or a server error), the panel opens on its own with "Signing you in" and one line, "P99 is busy, trying again in 1s", counting down. It tries again after 1, 2, 4 and 8 seconds, then every 30 seconds, only while the tab is in view, gives up on a try that hasn't answered in 10 seconds, and closes the moment the person is signed in. If the browser goes offline meanwhile, the line says so and it keeps trying; if P99 asks for the authenticator code, the panel asks for it and then closes signed in. Closing the panel stops the tries; the + then signs them in on the way and opens New card as usual. The code stays in the browser the whole time, so they never need the link again. The code sits in the link's fragment, which the browser never sends to a server, so it stays out of your server's, Cloudflare's and any analytics' logs and `Referer` headers. Treat the link as the secret it is. P99 keeps only the code's SHA-256, so a lost secret can't be shown again: mint a new code.

`--json` prints the code object, the secret, the links and `mail` (`sent`, `off`, `failed` or `skipped`, when mail was asked), for a script that sends the invitations.

## Access links

With mail on for the space (`p99 email set`, in [Set up P99](setup.md)), `p99 invite` mails the person their link through the space's mail provider:

```text
Grace Hopper <grace@example.com>
mailed the link for example.com, shop.example.com to grace@example.com
```

The mail, "Your P99 access for <space>", says in a line what the person can do and in which role, then walks them through it in numbered steps: open the link once in each browser they use, with one "Open P99 on <host>" button per host the code covers, sized for a phone, the busiest site first (the one with the most cards filed or changed in the last 30 days); what the + and the ⋯ beside it do on the site; and, for an Owner, the board, and the P99 page when the space has one. Its plain-text part lists each link as `https://<host>/#p99=<code>`. Replies go to the e-mail of whoever sent the invite. With `--totp`, P99 mails the authenticator setup separately, right after the link, as a second message: "Set up your authenticator for P99", with the QR code to scan, the key in groups of four and a link that adds it in one tap on a phone. The link is never in that mail and the key never in the link's, so one forwarded message never carries both, and the terminal prints neither. Add `--no-mail` to print the links and the key in the terminal instead, for you to send apart. When the space has no mail, or a mail doesn't go out, the terminal prints what didn't go once, with one line that says so.

Your own links never go by mail: inviting the e-mail in your config's `[me]` prints them in the terminal, one line per host, and `--mail-me` also mails them to you. P99 writes them nowhere, so save them in your password manager if you keep them there.

### Renew a link

```sh
p99 relink 3
p99 relink grace@example.com
p99 relink grace@example.com --host shop.example.com
p99 relink --self
```

`p99 relink` mints a new code for the same person, with the same name, e-mail, grant and role, and revokes the old one in the same request, so there is no moment when both work or neither does. It mails the new link as `p99 invite` does (with `--no-mail` and `--mail-me` the same way), and the old link answers 401 from then on. Name the code by its id from `p99 invites`, or by the person's e-mail when they hold one code; `--host` picks the code that covers that host, and `--self` takes your own e-mail from the config. Cards, comments and history follow the e-mail, so nothing is lost. A code with an authenticator keeps it: the new code gets the same secret, still encrypted in the Worker, so the person's app keeps giving the right 6-digit codes; each browser asks for one again, once. `--new-totp` gives the new code a new authenticator and mails its setup separately, as `p99 invite --totp` does.

### Open your own link

```sh
p99 link
p99 link shop.example.com
p99 link shop.example.com --print
```

`p99 link` opens your link in the default browser, built from the `code` your config keeps for the space: the 12 characters inline (the config file at mode 600), or a source that P99 reads at that moment, as it reads a token or a key: `{ file = "…" }`, `{ env = "…" }` or `{ command = ["…"] }`. P99 only reads it and never writes it there:

```toml
[spaces.pito]
code = { command = ["pass", "show", "p99/code"] }
```

With several hosts and none named, it asks which one in a terminal and lists them otherwise. `--print` prints the link instead of opening it; `P99_BROWSER` names another program to open it with.

## Owners and Users

A code holder is a User: they file cards (bugs, ideas, improvements and questions), and see and follow only the cards they filed. Add `--owner` to make the person an Owner, who sees and changes every card, files tasks, writes internal comments and runs the boards (`--manager` still works, as an alias):

```sh
p99 invite --space --name "Ada Lovelace" --email ada@example.com --owner
```

The e-mail you gave `p99 setup` is an Owner from the start: it is in the Worker's `MANAGERS` secret, and so is anyone you add there. A space may have several Owners.

Each code is limited to 120 requests a minute, and a User to 30 cards, 200 comments and 100 MiB of files a day. Owners have no daily limits.

## See who holds a code

```sh
p99 invites
p99 invites --host shop.example.com
p99 invites set 3 --project Shop
p99 invites set 3 --space
p99 invites set 3 --park
p99 codes --role owner
```

```text
   1  active  Ada Lovelace <ada@example.com>  Owner  ...7k2q  2026-09-14 12:00  grant: the whole space  last used: 2026-10-14 11:48
   2  revoked  Grace Hopper <grace@example.com>  User  ...3fpd  2026-09-19 12:00  hosts: shop.example.com  last used: 2026-09-22 12:00
   3  active  Grace Hopper <grace@example.com>  User  ...m9xa  2026-09-23 12:00  hosts: example.com, shop.example.com  last used: 2026-10-14 11:48
```

Each line is the code's id, its state, the person, the role (Owner or User), the secret's last four characters, when it was made, its hosts and when it was last used. `p99 codes` is the same command. `--role` keeps one role, `owner` or `user` (`manager`, `person` and `reporter` still work as aliases, for scripts written before). With `--json`, each code carries `"role":"owner"` or `"user"` beside the older `"manager"`. In `p99 tui`, `tab` switches to the same list on the Codes screen, with `/` to filter it.

## Revoke a code

```sh
p99 revoke 3
```

```text
revoked code 3 of Grace Hopper <grace@example.com>
```

The next request with that code answers 401, and the loader forgets it, so the "+" disappears from that browser. The person's cards and comments stay. To give someone a new code in place of the old one, use `p99 relink`; a code can't be changed or shown again. With an authenticator on the code, a forwarded link alone opens nothing in another browser, so revoking is for a link you want gone, or a person who should no longer file.

## Delete a revoked code

A revoked code stays in `p99 invites` until you delete it:

```sh
p99 invites delete 2
```

```text
   2  revoked  Grace Hopper <grace@example.com>  User  ...3fpd
Deleting it removes the code and its browsers' sign-ins for good; the person's items and comments stay.
Type 3fpd to delete it: 3fpd
deleted code 2 of Grace Hopper <grace@example.com>
```

It asks for the code's last four characters, the ones `p99 invites` shows after `...`, typed back. An active code is refused (`code 3 is active: revoke it first, p99 revoke 3`), so revoke it first. `--yes` deletes without asking, for scripts and agents, and is needed when no one is at a terminal; there is no undo. `p99 codes delete 2` is the same command. In `p99 tui`, `d` on a revoked code in the Codes screen asks for the same four characters.

## Add an authenticator

A code can ask for a 6-digit code from an authenticator app the first time each browser uses it. Mint it that way with `--totp`, or add an authenticator to a code someone already holds, keeping their link:

```sh
p99 invite --project Shop --name "Grace Hopper" --email grace@example.com --totp
p99 invites totp 3
```

With mail on, P99 mails the person the setup in a message of its own, apart from the link: which authenticator apps work (Google Authenticator, Microsoft Authenticator, a password manager, or the phone's built-in passwords app), the QR code to scan, the key in groups of four to type, and a link that adds it in one tap on a phone. The account shows as "P99: <their e-mail>", with a 6-digit code that changes every 30 seconds. The terminal says the setup went and prints no key. With `--no-mail`, or when the mail doesn't go out, the terminal prints the setup instead:

```text
key:    <32 base32 characters>   (paste it as a one-time password or setup key; totp is the same as a link)
totp:   otpauth://totp/P99:grace@example.com?secret=<32 base32 characters>&issuer=P99&algorithm=SHA1&digits=6&period=30
```

Both lines carry the same secret, shown this once. Paste the key: in your password manager as the entry's one-time-password key, or in Google Authenticator or Authy under "enter a setup key". The `otpauth://` line is for apps that take a setup link; if an app shows codes P99 refuses, set it up from the key instead. Send both apart from the link, so one forwarded message never carries both.

The first time a browser opens the link, the panel opens on its own and asks for the 6-digit code; after that the browser is remembered. Another browser, or one whose site data was cleared, asks again. After 10 wrong codes the authenticator locks; `p99 invites totp <id>` sets a new one, which also makes every browser of that code ask again, so it is the way to recover a lost phone too. `p99 invites` marks such codes `totp`.

## Move a person to a new e-mail

```sh
p99 people rename grace@example.com grace.hopper@example.org
```

```text
moved grace@example.com to grace.hopper@example.org: 2 items, 0 assigned, 1 comments, 3 events, 0 attachments, 1 codes
```

Everything under the old e-mail moves in one transaction on the whole space: cards, assignments, comments, events, attachments and codes, with their authenticators and links unchanged. Set the new e-mail in your config's `[me]` too, so your own new work lands under it.

## Next

[Work the inbox](inbox.md): read and answer what people file.
