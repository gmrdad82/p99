const KIND_LABELS = {
  bug: "Bug",
  feature: "Idea",
  improvement: "Improvement",
  question: "Question",
  task: "Task",
};

const STATUS_LABELS = {
  inbox: "received",
  doing: "in progress",
  review: "in review",
  fixed: "fixed",
  abandoned: "dropped",
  duplicate: "duplicate",
  new: "received",
  confirmed: "in progress",
  in_progress: "in progress",
  waiting: "in review",
  resolved: "fixed",
};

const EXCERPT_CHARS = 1000;

function excerpt(text) {
  const trimmed = (text || "").trim();
  const chars = Array.from(trimmed.normalize("NFC"));
  return chars.length > EXCERPT_CHARS ? `${chars.slice(0, EXCERPT_CHARS).join("")}…` : chars.join("");
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function lines(data) {
  const kind = KIND_LABELS[data.kind] || "Item";
  const status = STATUS_LABELS[data.status === "done" ? data.resolution || "fixed" : data.status] || data.status;
  const quoted = `“${data.title}”`;
  switch (data.template) {
    case "created":
      return {
        subject: `[${data.key}] New ${kind.toLowerCase()}: ${data.title}`,
        paragraphs: [`${data.actorName} sent ${data.key}: ${quoted}.`, excerpt(data.body)],
      };
    case "comment_to_managers":
      return {
        subject: `[${data.key}] New comment from ${data.actorName}`,
        paragraphs: [`${data.actorName} wrote on ${data.key} (${quoted}):`, excerpt(data.body)],
      };
    case "comment_to_reporter":
      return {
        subject: `[${data.key}] New reply on ${quoted}`,
        paragraphs: [`${data.actorName} replied on ${data.key}:`, excerpt(data.body)],
      };
    case "status":
      return {
        subject: `[${data.key}] Now ${status}`,
        paragraphs: [`${data.actorName} changed ${data.key} (${quoted}) to ${status}.`],
      };
    case "landed":
      return {
        subject: `[${data.key}] The fix is in ${data.env}`,
        paragraphs: [`The fix for ${data.key} (${quoted}) is in ${data.env}, version ${data.version}.`],
      };
    default:
      throw new Error(`unknown mail template ${data.template}`);
  }
}

export function composeMail(data) {
  const { subject, paragraphs } = lines(data);
  const body = paragraphs.filter((p) => p.length > 0);
  const open = data.link ? [`Open: ${data.link}`] : [];
  const text = [...body, ...open, "— P99"].join("\n\n") + "\n";
  const html =
    body.map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("") +
    (data.link ? `<p><a href="${escapeHtml(data.link)}">Open ${escapeHtml(data.key)}</a></p>` : "") +
    "<p>— P99</p>";
  return { subject, text, html };
}
