const KIND_LABELS = {
  bug: "Bug",
  feature: "Idea",
  improvement: "Improvement",
  question: "Question",
  task: "Task",
};

const STATUS_WORDS = {
  inbox: "Received",
  doing: "In progress",
  review: "In review",
  new: "Received",
  confirmed: "In progress",
  in_progress: "In progress",
  waiting: "In review",
  resolved: "Fixed",
  abandoned: "Dropped",
  duplicate: "Duplicate",
};

const RESOLUTION_WORDS = { fixed: "Fixed", abandoned: "Dropped", duplicate: "Duplicate" };

export const REPORTER_TEMPLATES = new Set(["comment_to_reporter", "status", "landed"]);

const LIGHT = {
  accent: "#3b7dd8",
  "on-accent": "#ffffff",
  ink: "#0c1a2b",
  muted: "#2b405a",
  rule: "#6d87a4",
};

const COLOUR = /^(#[0-9a-fA-F]{3,8}|(rgb|hsl)a?\([0-9.,%\s]{1,60}\)|[a-zA-Z]{3,20})$/;

const EXCERPT_CHARS = 1000;

function excerpt(text) {
  const trimmed = (text || "").trim();
  const chars = Array.from(trimmed.normalize("NFC"));
  return chars.length > EXCERPT_CHARS ? `${chars.slice(0, EXCERPT_CHARS).join("")}…` : chars.join("");
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function statusWord(status, resolution) {
  if (status === "done") return RESOLUTION_WORDS[resolution] || "Fixed";
  return STATUS_WORDS[status] || status;
}

export function palette(theme) {
  const out = { ...LIGHT };
  if (theme && typeof theme === "object") {
    for (const name of Object.keys(LIGHT)) {
      const value = theme[name];
      if (typeof value === "string" && COLOUR.test(value.trim())) out[name] = value.trim();
    }
  }
  return out;
}

function lines(data) {
  const kind = KIND_LABELS[data.kind] || "Card";
  const quoted = `“${data.title}”`;
  switch (data.template) {
    case "created":
      return {
        subject: `[${data.key}] New ${kind.toLowerCase()}: ${data.title}`,
        lead: `${data.actorName} sent ${data.key}: ${quoted}.`,
        quote: excerpt(data.body),
      };
    case "comment_to_managers":
      return {
        subject: `[${data.key}] New comment from ${data.actorName}`,
        lead: `${data.actorName} wrote on ${data.key} (${quoted}):`,
        quote: excerpt(data.body),
      };
    case "comment_to_reporter":
      return {
        subject: `[${data.key}] New reply on ${quoted}`,
        lead: `${data.actorName} replied on ${data.key}:`,
        quote: excerpt(data.body),
      };
    case "status": {
      if (data.merged_into) {
        return {
          subject: `[${data.key}] Merged into ${data.merged_into}: ${data.title}`,
          lead: `${data.actorName} merged ${data.key} (${quoted}) into ${data.merged_into}; you'll get its updates from now on.`,
          quote: "",
        };
      }
      const word = statusWord(data.status, data.resolution);
      return {
        subject: `[${data.key}] ${word}: ${data.title}`,
        lead: `${data.actorName} moved ${data.key} (${quoted}) to ${word}.`,
        quote: "",
      };
    }
    case "landed":
      return {
        subject: `[${data.key}] Fixed and shipped to ${data.env}`,
        lead: `The fix for ${data.key} (${quoted}) is in ${data.env}, version ${data.version}.`,
        quote: "",
      };
    default:
      throw new Error(`unknown mail template ${data.template}`);
  }
}

function paragraph(text, style) {
  return `<p style="${style}">${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
}

export function composeMail(data) {
  const { subject, lead, quote } = lines(data);
  const c = palette(data.theme);
  const text = [lead, quote, data.link ? `Open ${data.key}: ${data.link}` : "", "— P99"];
  if (data.optOut) text.push(`Stop mail about ${data.key}: ${data.optOut}`);
  const p = "margin:0 0 16px";
  const html = [
    `<div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.5;color:${c.ink};background:#ffffff;max-width:560px;padding:16px">`,
    paragraph(lead, p),
    quote ? paragraph(quote, `${p};padding:0 0 0 12px;border-left:3px solid ${c.accent}`) : "",
    data.link
      ? `<p style="${p}"><a href="${escapeHtml(data.link)}" style="display:inline-block;padding:8px 14px;border-radius:6px;background:${c.accent};color:${c["on-accent"]};font-weight:600;text-decoration:none">Open ${escapeHtml(data.key)}</a></p>`
      : "",
    `<p style="margin:0;padding-top:12px;border-top:1px solid ${c.rule};font-size:13px;color:${c.muted}">— P99`,
    data.optOut
      ? `<br><a href="${escapeHtml(data.optOut)}" style="color:${c.muted}">Stop mail about ${escapeHtml(data.key)}</a>`
      : "",
    "</p></div>",
  ].join("");
  return { subject, text: text.filter((t) => t.length > 0).join("\n\n") + "\n", html };
}
