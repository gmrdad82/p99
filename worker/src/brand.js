export function linkShown(env, config) {
  return !(env && env.LICENSE_LINK === "hideable" && config && config.link === false);
}
