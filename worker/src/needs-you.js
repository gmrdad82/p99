import { K, laneIndex } from "./cards.js";
import { cardsOf, waitingCountStatement, waitingListStatement } from "./cards-read.js";
import { lanesOf, lanesStatement, placeStatement, topOf } from "./cards-write.js";
import { labelChangeStatements } from "./boards.js";
import { sameFolded } from "./text.js";

const NEEDS_YOU = laneIndex("needs-you");
const FALLBACK = laneIndex("in-progress");
const LANE_AT_SQL = `SELECT (SELECT count(*) FROM board_columns x WHERE x.board_id = bc.board_id AND x.position < bc.position) AS at
  FROM board_columns bc JOIN boards b ON b.id = bc.board_id AND b.cards = 1 WHERE bc.label_id = ?1`;
const LAST_MOVE_SQL = `SELECT json_extract(detail_json, '$.from') AS name FROM events
  WHERE item_id = ?1 AND kind = 'label' AND json_extract(detail_json, '$.migrated') IS NOT 1
  ORDER BY id DESC LIMIT 1`;

export async function getWaiting(c) {
  K.requireEmptyBody(c);
  K.requireManager(c);
  const { DB } = c.env;
  const [listed, counted] = await DB.batch([waitingListStatement(c), waitingCountStatement(c)]);
  return K.json(200, { count: counted.results[0]?.n ?? 0, cards: await cardsOf(c, listed.results) });
}

export async function waitingCount(c, words) {
  if (!c.manager) return null;
  const row = await waitingCountStatement(c, words).first();
  return row ? row.n : 0;
}

export function backLane(lanes, name) {
  const open = lanes.filter((l, at) => at !== NEEDS_YOU && at < lanes.length - 1);
  if (typeof name === "string") {
    const exact = open.find((l) => l.name === name);
    if (exact) return exact;
    const folded = open.filter((l) => sameFolded(l.name, name));
    if (folded.length === 1) return folded[0];
  }
  return lanes[FALLBACK] ?? null;
}

const STAY = { statements: [], after() {} };

export async function leaveNeedsYou(c, row) {
  if (!c.manager || !c.actor || c.actor.agent || !row.open) return STAY;
  const { DB } = c.env;
  const at = await DB.prepare(LANE_AT_SQL).bind(row.label_id).first();
  if (!at || at.at !== NEEDS_YOU) return STAY;
  const [read, moved] = await DB.batch([lanesStatement(c), DB.prepare(LAST_MOVE_SQL).bind(row.id)]);
  const lanes = lanesOf(read.results);
  const needs = lanes ? lanes.lanes[NEEDS_YOU] : null;
  if (!needs || row.label_id !== needs.id) return STAY;
  const back = backLane(lanes.lanes, moved.results[0]?.name ?? null);
  if (!back || back.id === needs.id) return STAY;
  const to = { ...back, closes: 0 };
  const plan = labelChangeStatements(c, row, to, {});
  const place = await topOf(c, lanes.board, to.id, row.id);
  return {
    statements: [...plan.statements, placeStatement(c, lanes.board, to.id, place, row.client_uid, true)],
    after(update) {
      if (!update?.meta?.changes) return;
      plan.after();
      K.push(c, "order", row, { board: lanes.board, order: place.key, ...(place.rows.length > 1 ? { rebalanced: true } : {}) });
    },
  };
}

export const NEEDS_ROUTES = [["GET", /^\/cards\/waiting$/, getWaiting]];
