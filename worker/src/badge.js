const STATES = ["free", "studio", "agency", "owner", "ff"];

export function licenseState(env) {
  const word = env && typeof env.LICENSE_STATE === "string" ? env.LICENSE_STATE : "";
  return STATES.includes(word) ? word : "free";
}
