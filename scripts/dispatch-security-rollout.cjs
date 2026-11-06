'use strict';

/** Select configured live sites; archived and purged console sites stay down. */
async function liveClients({ db, environments, variablesFor }) {
  const clients = [];
  for (const environment of environments) {
    const vars = await variablesFor(environment.name);
    if (!vars.EVENT_FIREBASE_PROJECT_ID) continue;
    if (!vars.WIF_PROVIDER || !vars.WIF_SERVICE_ACCOUNT) throw new Error(`Incomplete deployment identity for ${environment.name}`);
    const appId = vars.EVENTRUNNER_REQUEST_ID;
    if (appId) {
      const [app, tomb] = await Promise.all([
        db.collection('applications').doc(appId).get(), db.collection('console_deleted_sites').doc(appId).get(),
      ]);
      if (tomb.exists || !app.exists || !['ready', 'launched'].includes(app.data().status)) continue;
    }
    clients.push(environment.name);
  }
  return clients;
}

async function rollout({ db, env = process.env, fetchImpl = fetch, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), log = console }) {
  const repo = 'CenterCoopMedia/eventrunner';
  if (env.GITHUB_REPOSITORY !== repo || env.GITHUB_REF !== 'refs/heads/main' || !env.GITHUB_TOKEN) throw new Error('Security rollout requires this repository on main');
  const api = async (path, body) => {
    const result = await fetchImpl(`https://api.github.com/repos/${repo}/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    if (!result.ok) throw new Error(`GitHub rollout request failed (${result.status})`);
    return result.status === 204 ? null : result.json();
  };
  const pages = async (path, field) => {
    const all = [];
    for (let page = 1; page <= 100; page += 1) {
      const result = await api(`${path}?per_page=100&page=${page}`);
      const rows = result[field];
      if (!Array.isArray(rows)) throw new Error('Malformed GitHub rollout response');
      all.push(...rows);
      if (rows.length < 100) return all;
    }
    throw new Error('GitHub rollout listing exceeded its page budget');
  };
  const clients = await liveClients({ db, environments: await pages('environments', 'environments'),
    variablesFor: async (name) => Object.fromEntries((await pages(`environments/${encodeURIComponent(name)}/variables`, 'variables')).map((v) => [v.name, v.value])),
  });
  if (!clients.length) throw new Error('No configured active client deployments were found');
  const started = new Date().toISOString();
  for (const client of clients) {
    await api('actions/workflows/deploy.yml/dispatches', { ref: 'main', inputs: { client, provision: 'true', bootstrap: 'false' } });
    log.log(`Dispatched security rollout for ${client}`);
  }
  const pending = new Set(clients);
  const found = new Map();
  for (let poll = 0; poll < 220 && pending.size; poll += 1) {
    await wait(30_000);
    const result = await api('actions/workflows/deploy.yml/runs?event=workflow_dispatch&per_page=100');
    for (const client of pending) {
      const run = result.workflow_runs.find((r) => r.head_sha === env.GITHUB_SHA && r.created_at >= started && r.display_title === `Deploy ${client}`);
      if (!run) continue;
      if (!found.has(client)) log.log(`Deployment ${client}: ${run.html_url}`);
      found.set(client, run);
      if (run.status === 'completed') pending.delete(client);
    }
  }
  for (const client of clients) {
    const run = found.get(client);
    log.log(`${client}: ${run?.conclusion || run?.status || 'not-observed'} ${run?.html_url || ''}`);
  }
  if (pending.size || clients.some((client) => found.get(client)?.conclusion !== 'success')) throw new Error('One or more client security deployments did not succeed');
  return clients;
}

if (require.main === module) {
  const { initializeApp } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  if (!process.env.CONSOLE_PROJECT_ID) throw new Error('CONSOLE_PROJECT_ID is required');
  initializeApp({ projectId: process.env.CONSOLE_PROJECT_ID });
  rollout({ db: getFirestore() }).catch((err) => { console.error(err.message); process.exitCode = 1; });
}
module.exports = { liveClients, rollout };
