import { todo } from "./cards.js";

export async function listCards(c) {
  return todo();
}

export async function getCard(c, rawKey) {
  return todo();
}

export async function listProjects(c) {
  return todo();
}

export function cardSide(board, item) {
  return `(${board}.id IS NOT NULL OR ${item}.id IS NOT NULL)`;
}

export function cardFilters(c, params, q, where) {
  return where;
}

export const CARD_READS = [
  ["GET", /^\/cards$/, listCards],
  ["GET", /^\/cards\/([^/]+)$/, getCard],
  ["GET", /^\/projects$/, listProjects],
];
