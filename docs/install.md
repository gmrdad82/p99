---
title: Install
description: Install the p99 binary on Linux, macOS or Windows through WSL, then set up a space and file the first item.
sidebar:
  order: 2
---

`p99` is one binary: the CLI, the TUI inbox and the Worker it uploads to Cloudflare. It runs on Linux and macOS, and on Windows through WSL.

P99: got questions or doubts? [Ping me on Discord](https://discord.gg/XsNcn3kYzn).

## Linux and WSL

Each [release](https://github.com/gmrdad82/p99/releases/latest) carries a Linux x86_64 binary with a `SHA256SUMS` file:

```sh
v=$(basename "$(curl -fsSLo /dev/null -w '%{url_effective}' https://github.com/gmrdad82/p99/releases/latest)")
mkdir -p ~/.local/bin && curl -fsSL "https://github.com/gmrdad82/p99/releases/download/$v/p99-$v-linux-x86_64.tar.gz" | tar -xz -C ~/.local/bin p99
```

On Windows, install WSL (`wsl --install` in an administrator PowerShell), open the Ubuntu shell and run the same two lines there.

## macOS

The macOS binary is built for Apple Silicon, on an Apple Silicon Mac:

```sh
v=$(basename "$(curl -fsSLo /dev/null -w '%{url_effective}' https://github.com/gmrdad82/p99/releases/latest)")
mkdir -p ~/.local/bin && curl -fsSL "https://github.com/gmrdad82/p99/releases/download/$v/p99-$v-macos-arm64.tar.gz" | tar -xz -C ~/.local/bin p99
```

`~/.local/bin` needs to be on your `PATH`.

## Check the download

Every release lists the SHA-256 of each archive in `SHA256SUMS`:

```sh
curl -fsSLO "https://github.com/gmrdad82/p99/releases/download/$v/p99-$v-linux-x86_64.tar.gz"
curl -fsSL "https://github.com/gmrdad82/p99/releases/download/$v/SHA256SUMS" | sha256sum --check --ignore-missing
```

On macOS use `shasum -a 256 --check` in place of `sha256sum --check`.

## From source

With Rust 1.97 or newer:

```sh
cargo install --locked --git https://github.com/gmrdad82/p99 --tag vX.Y.Z p99
```

The Worker is built into the binary, so there is nothing else to install: no Node, no wrangler.

## Quick start

1. Check the binary:

   ```sh
   p99 --version
   p99 bundle
   ```

   `p99 bundle` lists the Worker this build uploads, without touching Cloudflare.

2. Set up a Cloudflare account. `p99 setup` asks for your name, your e-mail and a Cloudflare API token, then creates the D1 database, the R2 bucket, the Worker and a route for each host:

   ```sh
   p99 setup
   ```

   [Set up a space](guides/setup.md) walks through every question.

3. Put one tag in the `<head>` of every page of the site:

   ```html
   <script src="/_p99/p99.js" async></script>
   ```

   [Put P99 on a site](guides/site.md) covers placement, Content-Security-Policy and Cloudflare Access.

4. Invite yourself and open the link it prints:

   ```sh
   p99 invite example.com --name "Ada Lovelace" --email ada@example.com --owner
   ```

   The "+" now shows on your pages. File a bug from it, then read it in the terminal:

   ```sh
   p99 list example.com
   p99
   ```

The config lives in `~/.config/p99/config.toml`; [the configuration reference](reference/formats.md#configuration) lists every key.
