import { todo } from "./cards.js";

export async function postCard(c) {
  return todo();
}

export async function postCardStatus(c, rawKey) {
  return todo();
}

export async function postCardLink(c, rawKey) {
  return todo();
}

export async function postCardComment(c, rawKey) {
  return todo();
}

export async function patchProject(c, row, body) {
  return todo();
}

export function refuseAgentClose(c, row, to) {
  return to;
}

export const CARD_WRITES = [
  ["POST", /^\/cards$/, postCard],
  ["POST", /^\/cards\/([^/]+)\/status$/, postCardStatus],
  ["POST", /^\/cards\/([^/]+)\/links$/, postCardLink],
  ["POST", /^\/cards\/([^/]+)\/comments$/, postCardComment],
];
