export const LANES = ["new", "planned", "in-progress", "needs-you", "stuck", "landed", "done"];
export const LANE_NAMES = ["New", "Planned", "In progress", "Needs you", "Stuck", "Landed", "Done"];
export const WAITING_LANES = ["needs-you", "stuck", "landed"];
export const MAX_PROJECT_CHARS = 40;
export const MAX_VIA_CHARS = 80;
export const MAX_REF_CHARS = 200;
export const MAX_NOTE_CHARS = 200;
export const DEFAULT_CARDS_LIMIT = 200;
export const MAX_CARDS_LIMIT = 500;
export const NOT_YET = "this Worker has no cards yet; run p99 deploy";
export const PERSON_CLOSES = "only a person closes a card";
export const PERSON_UNCARDS = "only a person takes a card off its project";
export const ROBOT = "🤖";
export const PROJECT_RULE = `a project name has 1 to ${MAX_PROJECT_CHARS} characters`;

export let K = null;

export function useKit(kit) {
  K = kit;
}

export function refuseAgentUncard(c, row, body) {
  if (row.project !== null && row.project !== undefined && body.project === null && c.actor?.agent) K.fail(403, PERSON_UNCARDS);
}

export function laneIndex(word) {
  return LANES.indexOf(word);
}

export function laneWord(index) {
  return LANES[index] ?? null;
}

export function notCard(key) {
  return `${key} has no project of its own; give it one with p99 edit ${key} --project <name>`;
}

export function personOf(name, username, agent, via) {
  return { name: name ?? null, username: username ?? null, agent: Boolean(agent), via: agent ? (via ?? null) : null };
}

export function actorVia(raw) {
  if (typeof raw !== "string") return null;
  const text = K.clean(raw).trim();
  return text.length === 0 ? null : [...text].slice(0, MAX_VIA_CHARS).join("");
}

export function projectName(raw) {
  const text = typeof raw === "string" ? K.clean(raw).trim() : "";
  if (text.length < 1 || [...text].length > MAX_PROJECT_CHARS) K.fail(400, PROJECT_RULE);
  return text;
}
