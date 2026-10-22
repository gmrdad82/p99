import { K, LANES, todo } from "./cards.js";
import { sameFolded } from "./text.js";

export const BOARDS_GONE = "boards are one per account; see p99 board";
export const BOARDS_DEPRECATED = "one board per account since 1.10; read /board";
export const NOT_ARCHIVED = "(NOT EXISTS (SELECT 1 FROM archived a WHERE a.kind = 'board' AND a.id = b.id))";
export const LIVE_LABEL = "(NOT EXISTS (SELECT 1 FROM archived a WHERE a.kind = 'label' AND a.id = l.id))";

export function laneOf(lanes, to) {
  const at = LANES.indexOf(to);
  if (at >= 0) return lanes[at] ?? null;
  const named = lanes.filter((l) => sameFolded(l.name, to));
  return named.length === 1 ? named[0] : null;
}

export function boardFilter(c, params) {
  return { projects: [], hosts: [], source: null, statuses: [] };
}

export function oneBoardSql(v, filter) {
  return { sql: "SELECT NULL WHERE false", binds: [] };
}

export async function getOneBoard(c) {
  return todo();
}

export async function getBoardsDeprecated(c) {
  return todo();
}

export async function getArchivedBoard(c, rawId) {
  return todo();
}

export async function goneBoards(c) {
  K.requireManager(c);
  K.fail(410, BOARDS_GONE);
}

export async function moveByLane(c, body) {
  return todo();
}

export const ONE_BOARD_ROUTES = [
  ["GET", /^\/board$/, getOneBoard],
  ["GET", /^\/boards$/, getBoardsDeprecated],
  ["POST", /^\/boards$/, goneBoards],
  ["GET", /^\/boards\/([^/]+)$/, getArchivedBoard],
  ["PUT", /^\/boards\/([^/]+)$/, goneBoards],
  ["DELETE", /^\/boards\/([^/]+)$/, goneBoards],
];
