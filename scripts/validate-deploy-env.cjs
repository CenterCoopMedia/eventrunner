#!/usr/bin/env node
'use strict';

/**
 * CLI wrapper for `validateDeployEnv` (packages/shared/src/config/deploy.cjs)
 * — run by deploy-client.yml's `validate-env` job before anything else in
 * the deploy touches GCP (spec §2.1). Without this, an unset GitHub
 * Environment variable becomes an empty string in the workflow's `env:`
 * block and silently reaches `firebase deploy` / `vite build` as a blank
 * value instead of failing the run with a clear name.
 *
 * Exits 0 and prints nothing on success (quiet success, per the other
 * scripts' convention); exits 1 with every missing/invalid key named on
 * failure — never just the first one, since a client environment is
 * usually missing several fields at once during onboarding.
 */

const { validateDeployEnv } = require('../packages/shared/src/config/deploy.cjs');

/**
 * @param {{ ok: boolean, missing: string[], errors: string[] }} result
 * @returns {string}
 */
function formatReport(result) {
  const lines = [];
  if (result.missing.length > 0) {
    lines.push(`Missing required variable(s): ${result.missing.join(', ')}`);
  }
  if (result.errors.length > 0) {
    lines.push(...result.errors.map((e) => `Invalid: ${e}`));
  }
  return lines.join('\n');
}

function main(env = process.env) {
  const result = validateDeployEnv(env);
  if (!result.ok) {
    console.error(`validate-deploy-env: deploy-time environment is invalid.\n${formatReport(result)}`);
    return 1;
  }
  console.log('validate-deploy-env: ok');
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { main, formatReport };
