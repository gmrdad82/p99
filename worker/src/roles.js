import { K } from "./cards.js";

export const ROLES = ["owner", "user"];
export const ROLE_WORDS = { owner: "Owner", user: "User" };

export function roleOf(manager) {
  return manager ? "owner" : "user";
}

export function roleWord(manager) {
  return ROLE_WORDS[roleOf(manager)];
}

export function managerOf(body) {
  if (body.role !== undefined && body.role !== null) {
    if (!ROLES.includes(body.role)) K.fail(400, "role must be owner or user");
    if (body.manager !== undefined && body.manager !== null && body.manager !== (body.role === "owner")) K.fail(400, "role and manager disagree");
    return body.role === "owner";
  }
  return body.manager === true;
}
