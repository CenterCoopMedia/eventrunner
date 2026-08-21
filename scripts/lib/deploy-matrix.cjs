'use strict';

/**
 * Pure logic for `deploy.yml`'s `resolve` job (spec §8.1, issue #19).
 *
 * `inputs.client` alone cannot bind a GitHub Environment for a push-triggered
 * run: it only exists on `workflow_dispatch`, so a push run would evaluate it
 * to the empty string and silently run with no environment (and none of its
 * secrets). `resolveClients` is the one place that decides, per trigger
 * shape, which client environments a run fans out to — kept here instead of
 * inline bash so it is unit-testable and `npm test` covers it.
 */

/** @param {*} v @returns {boolean} */
function present(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * @param {{ eventName: string, dispatchClient?: string,
 *           autoDeployEnvironments?: string }} opts
 * @returns {string[]} client environment names to fan out to, in order,
 *   with no duplicates and no blank entries. Empty when there is nothing to
 *   deploy (a push with an unset/empty AUTO_DEPLOY_ENVIRONMENTS variable).
 */
function resolveClients({ eventName, dispatchClient, autoDeployEnvironments }) {
  if (eventName === 'workflow_dispatch') {
    return present(dispatchClient) ? [dispatchClient.trim()] : [];
  }

  if (!present(autoDeployEnvironments)) return [];

  const seen = new Set();
  const clients = [];
  for (const raw of autoDeployEnvironments.split(',')) {
    const client = raw.trim();
    if (client.length === 0) continue;
    if (seen.has(client)) continue;
    seen.add(client);
    clients.push(client);
  }
  return clients;
}

/**
 * Build the OPTIONS-preflight smoke-test URLs for one deployment (spec
 * §8.1's `smoke` job): one per function name, against the deployment's
 * Cloud Functions domain.
 *
 * @param {{ region: string, projectId: string, endpoints: string[] }} opts
 * @returns {string[]}
 */
function buildSmokeUrls({ region, projectId, endpoints }) {
  if (!present(region)) throw new Error('buildSmokeUrls: region is required');
  if (!present(projectId)) throw new Error('buildSmokeUrls: projectId is required');
  if (!Array.isArray(endpoints) || endpoints.length === 0) {
    throw new Error('buildSmokeUrls: endpoints must be a non-empty array');
  }
  const base = `https://${region.trim()}-${projectId.trim()}.cloudfunctions.net`;
  return endpoints.map((name) => {
    if (!present(name)) throw new Error('buildSmokeUrls: endpoint names must be non-empty strings');
    return `${base}/${name.trim()}`;
  });
}

module.exports = { resolveClients, buildSmokeUrls };
