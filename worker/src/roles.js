import { K } from "./cards.js";

export const ROLES = ["owner", "user"];
export const ROLE_WORDS = { owner: "Owner", user: "User" };
export const MANAGER_GONE = "manager is gone; send role: owner or user";

export function roleOf(manager) {
  return manager ? "owner" : "user";
}

export function roleWord(manager) {
  return ROLE_WORDS[roleOf(manager)];
}

export function managerOf(body) {
  if (body.manager !== undefined) K.fail(400, MANAGER_GONE);
  if (body.role === undefined || body.role === null) return false;
  if (!ROLES.includes(body.role)) K.fail(400, "role must be owner or user");
  return body.role === "owner";
}
