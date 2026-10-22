import { LIVE_LABEL } from "./one-board.js";
import { namedBy } from "./text.js";

let fail, requireManager;

export function bindLabels(helpers) {
  ({ fail, requireManager } = helpers);
}

const GONE = {
  priority: "items have no priority: an item's place in its lane is its priority, so move it up or down the lane",
  labels: "an item has one label, its state; set it with POST /move",
};

export function refuseGone(body) {
  for (const [field, message] of Object.entries(GONE)) {
    if (Object.prototype.hasOwnProperty.call(body, field)) fail(400, message);
  }
}

export async function labelFilters(c, params, q, where) {
  if (params.has("priority")) fail(400, GONE.priority);
  const wanted = params.getAll("label");
  if (wanted.length === 0) return;
  requireManager(c);
  if (wanted.length > 1) fail(400, "an item has one label; ask for one");
  const asked = wanted[0].trim().replace(/\s+/g, " ");
  const { results } = await c.env.DB.prepare(`SELECT l.id, l.name FROM labels l WHERE ${LIVE_LABEL}`).all();
  const ids = namedBy(results, asked, (l) => l.name).map((l) => q.bind(l.id));
  where.push(ids.length > 0 ? `i.label_id IN (${ids.join(", ")})` : "0");
}
