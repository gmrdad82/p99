import { todo } from "./cards.js";

export const REVOKE_FIRST = "revoke it first";

let forget = () => {};

export function useCodesKit(kit) {
  forget = kit.forget;
}

export async function deleteCode(c, rawId) {
  forget();
  return todo();
}
