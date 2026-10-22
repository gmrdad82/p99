import { K } from "./cards.js";

export const REVOKE_FIRST = "revoke it first";

const REVOKED = "EXISTS (SELECT 1 FROM codes WHERE id = ?1 AND revoked_at IS NOT NULL)";

let forget = () => {};

export function useCodesKit(kit) {
  forget = kit.forget;
}

export async function deleteCode(c, rawId) {
  K.requireEmptyBody(c);
  const id = Number(rawId);
  const { DB } = c.env;
  const row = await DB.prepare("SELECT id, revoked_at FROM codes WHERE id = ?1").bind(id).first();
  if (!row) K.fail(404, "no such code");
  if (!row.revoked_at) K.fail(409, REVOKE_FIRST);
  const results = await DB.batch([
    DB.prepare(`DELETE FROM code_devices WHERE code_id = ?1 AND ${REVOKED}`).bind(id),
    DB.prepare(`DELETE FROM app_sessions WHERE code_id = ?1 AND ${REVOKED}`).bind(id),
    DB.prepare("DELETE FROM codes WHERE id = ?1 AND revoked_at IS NOT NULL RETURNING id").bind(id),
  ]);
  forget();
  if ((results[2].results ?? []).length === 0) K.fail(404, "no such code");
  return K.json(200, { id, deleted: true });
}
