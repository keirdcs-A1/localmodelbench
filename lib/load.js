/**
 * Local overrides.
 *
 * The fixtures and benchmark cases in this repo describe an invented person, so
 * the project can be shared safely. If you want the benchmark to reflect your
 * own life, do NOT edit the tracked files: copy them to a `.local.js` sibling
 * and edit that. Those files are gitignored, so real details about your
 * calendar, inbox and memory can never leave your machine in a push.
 *
 *   lib/fixtures.js            ->  lib/fixtures.local.js
 *   benchmarks/tool-calling.js ->  benchmarks/tool-calling.local.js
 *   benchmarks/coding.js       ->  benchmarks/coding.local.js
 *   benchmarks/general.js      ->  benchmarks/general.local.js
 *
 * A local file replaces the tracked one entirely for whatever it exports.
 */

/** Load a module, letting a gitignored `.local.js` sibling override it. */
export async function loadWithLocalOverride(basePath, localPath) {
  const base = await import(basePath);
  try {
    const local = await import(localPath);
    return { module: { ...base, ...local }, usingLocal: true };
  } catch (error) {
    // Missing file is the normal case. Anything else is a real error in the
    // override, and silently ignoring it would be baffling to debug.
    if (error?.code !== "ERR_MODULE_NOT_FOUND" || !String(error.message).includes(localPath.replace("./", ""))) {
      if (error?.code !== "ERR_MODULE_NOT_FOUND") {
        console.error(`\n  Your ${localPath} failed to load, so the built-in version is being used instead:\n  ${error.message}\n`);
      }
    }
    return { module: base, usingLocal: false };
  }
}
