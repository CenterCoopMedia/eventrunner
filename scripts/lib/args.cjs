'use strict';

/**
 * Tiny argv parser shared by the operator scripts (spec §5.1, §5.6).
 *
 * Deliberately not a dependency: these scripts run on a fresh clone, from
 * CI, and from a laptop with only the workspace installed, so the argument
 * surface stays in the repo. Pure — no process, no env, no I/O — so the
 * flag contract of every script is unit-testable without spawning it.
 *
 * Contract:
 *   --flag value      → { flag: 'value' }
 *   --flag=value      → { flag: 'value' }
 *   --flag            → { flag: true } when `flag` is not in `withValue`
 *   repeatable flags  → array, in argv order (e.g. --admin a --admin b)
 *   positionals       → `_`
 *
 * Unknown flags are returned rather than thrown on; each script decides
 * whether an unknown flag is a typo worth refusing (they all do — an
 * operator who mistypes `--anwsers` must not get a silent interactive
 * prompt instead of the file they meant).
 */

/**
 * @param {string[]} argv raw arguments (already sliced past node + script)
 * @param {{ withValue?: string[], repeatable?: string[] }} [spec]
 * @returns {{ _: string[], [flag: string]: string|boolean|string[] }}
 */
function parseArgv(argv, spec = {}) {
  const withValue = new Set(spec.withValue || []);
  const repeatable = new Set(spec.repeatable || []);
  for (const name of repeatable) withValue.add(name);

  const out = { _: [] };
  const push = (name, value) => {
    if (repeatable.has(name)) {
      if (!Array.isArray(out[name])) out[name] = [];
      out[name].push(value);
    } else {
      out[name] = value;
    }
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (typeof arg !== 'string' || !arg.startsWith('--')) {
      out._.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq !== -1) {
      push(body.slice(0, eq), body.slice(eq + 1));
      continue;
    }
    if (withValue.has(body)) {
      const next = argv[i + 1];
      if (typeof next !== 'string' || next.startsWith('--')) {
        push(body, '');
      } else {
        push(body, next);
        i += 1;
      }
      continue;
    }
    push(body, true);
  }
  return out;
}

/**
 * Flag names present in `parsed` that no script declared. Returned rather
 * than thrown so the caller owns the message and the exit code.
 *
 * @param {object} parsed result of parseArgv
 * @param {string[]} known every accepted flag name
 * @returns {string[]}
 */
function unknownFlags(parsed, known) {
  const allowed = new Set(known);
  return Object.keys(parsed).filter((key) => key !== '_' && !allowed.has(key));
}

module.exports = { parseArgv, unknownFlags };
