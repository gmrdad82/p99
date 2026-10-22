import { K, todo } from "./cards.js";

export const PERSON_UNCARDS = "only a person turns a card back into an item";

export async function getWaiting(c) {
  return todo();
}

export async function waitingCount(c) {
  if (!c.manager) return null;
  return null;
}

export function leaveNeedsYou(c, row) {
  return [];
}

export function refuseAgentUncard(c, row, body) {
  if (row.project !== null && body.project === null && c.actor?.agent) K.fail(403, PERSON_UNCARDS);
}

export const NEEDS_ROUTES = [["GET", /^\/cards\/waiting$/, getWaiting]];
