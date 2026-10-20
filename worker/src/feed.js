export const FEED_LIMIT = 50;
export const FEED_MAX_AGE = 300;

const ATOM_TYPE = "application/atom+xml; charset=utf-8";
const JSON_FEED_TYPE = "application/feed+json; charset=utf-8";

function xml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "");
}

function atom(host, entries, since) {
  const self = `https://${host}/_p99/feed`;
  const updated = entries.length > 0 ? entries[0].at : since;
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `<id>${xml(self)}</id>`,
    `<title>${xml(host)}: fixed</title>`,
    `<updated>${xml(updated)}</updated>`,
    `<link rel="self" href="${xml(self)}"/>`,
    `<link rel="alternate" href="https://${xml(host)}/"/>`,
    `<author><name>${xml(host)}</name></author>`,
    "<generator>P99</generator>",
  ];
  for (const e of entries) {
    lines.push(
      "<entry>",
      `<id>${xml(`${self}#${e.key}`)}</id>`,
      `<title>${xml(`${e.key}: ${e.title}`)}</title>`,
      `<updated>${xml(e.at)}</updated>`,
      `<category term="${xml(e.kind)}"/>`,
      `<content type="text">${xml(e.title)}</content>`,
      "</entry>",
    );
  }
  lines.push("</feed>");
  return lines.join("\n") + "\n";
}

function jsonFeed(host, entries) {
  return (
    JSON.stringify({
      version: "https://jsonfeed.org/version/1.1",
      title: `${host}: fixed`,
      home_page_url: `https://${host}/`,
      feed_url: `https://${host}/_p99/feed?format=json`,
      items: entries.map((e) => ({
        id: e.key,
        title: `${e.key}: ${e.title}`,
        content_text: e.title,
        date_published: e.at,
        tags: [e.kind],
      })),
    }) + "\n"
  );
}

export function feedFormat(url) {
  const format = url.searchParams.get("format") || "atom";
  return format === "atom" || format === "json" ? format : null;
}

export function feedResponse(host, entries, since, format) {
  const json = format === "json";
  return new Response(json ? jsonFeed(host, entries) : atom(host, entries, since), {
    status: 200,
    headers: {
      "content-type": json ? JSON_FEED_TYPE : ATOM_TYPE,
      "cache-control": `public, max-age=${FEED_MAX_AGE}`,
      "x-content-type-options": "nosniff",
      "access-control-allow-origin": "*",
    },
  });
}
