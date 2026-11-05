'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FUNCTIONS_DIR = path.join(__dirname, '..', '..');

/**
 * Firebase reads this code at deploy time to learn each function's settings,
 * and gives that read only its own variables: not the workflow's and not
 * `functions/.env.<project-id>`. Secrets are chosen by provider name, so
 * without this every function deploys with none, and fails when it runs.
 * Variables already set win.
 */
function loadDeployEnv({ env = process.env, dir = FUNCTIONS_DIR } = {}) {
  if (env.FUNCTIONS_CONTROL_API !== 'true' || !env.GCLOUD_PROJECT) return false;
  const file = path.join(dir, `.env.${env.GCLOUD_PROJECT}`);
  if (!fs.existsSync(file)) return false;
  process.loadEnvFile(file);
  return true;
}

module.exports = { loadDeployEnv };
