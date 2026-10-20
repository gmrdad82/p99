let fail, requireManager;

export function bindLabels(helpers) {
  ({ fail, requireManager } = helpers);
}

const GONE = {
  priority: "items have no priority: an item's place in its lane is its priority, so move it up or down the lane",
  labels: "an item has one label, its state; set it with POST /move",
  status: "an item's state is its label; set it with POST /move, or close it with resolution",
};

export function refuseGone(body) {
  for (const [field, message] of Object.entries(GONE)) {
    if (Object.prototype.hasOwnProperty.call(body, field)) fail(400, message);
  }
}

export function labelFilters(c, params, q, where) {
  if (params.has("priority")) fail(400, GONE.priority);
  const wanted = params.getAll("label");
  if (wanted.length === 0) return;
  requireManager(c);
  if (wanted.length > 1) fail(400, "an item has one label; ask for one");
  where.push(`i.label_id = (SELECT id FROM labels WHERE name = ${q.bind(wanted[0])})`);
}
