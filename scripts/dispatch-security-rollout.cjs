'use strict';

/** Console build records own target identity; no GitHub administration API is needed. */
async function liveClients({ db, legacyClients = [] }) {
  const clients = new Set();
  const blocked = new Set();
  const valid = (name) => typeof name === 'string' && /^[a-z0-9][a-z0-9-]{0,62}$/.test(name)
    && !['console', 'provisioning', 'github-pages'].includes(name);
  const environmentOf = (record) => record?.resources?.githubEnvironment || record?.resources?.environment || record?.environmentClaim;
  const each = async (collection, visit) => {
    let cursor;
    for (;;) {
      let query = db.collection(collection).orderBy('__name__').limit(200);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      for (const doc of page.docs) await visit(doc);
      if (page.size < 200) return;
      cursor = page.docs.at(-1);
    }
  };
  await each('applications', async (doc) => {
    const [app, build, tomb] = await Promise.all([
      doc.ref.get(), db.collection('console_builds').doc(doc.id).get(), db.collection('console_deleted_sites').doc(doc.id).get(),
    ]);
    const target = environmentOf(build.data());
    const active = app.exists && !tomb.exists && ['ready', 'launched'].includes(app.data().status);
    if (active && !valid(target)) throw new Error('An active console site has no valid recorded deployment environment');
    if (!valid(target)) return;
    if (active) clients.add(target);
    else blocked.add(target);
  });
  await each('console_deleted_sites', async (doc) => {
    const target = environmentOf(doc.data());
    if (valid(target)) blocked.add(target);
  });
  for (const target of legacyClients) {
    if (!valid(target)) throw new Error('Invalid legacy client environment');
    clients.add(target);
  }
  return [...clients].filter((name) => !blocked.has(name)).sort();
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
    if (!result.ok) throw new Error(`GitHub rollout request failed (${result.status}) at ${path.split('?')[0]}`);
    return result.status === 204 ? null : result.json();
  };
  const release = require('../.github/security-rollout-2026-11-06.json');
  const legacyClients = [...(release.legacyClients || []), ...(env.LEGACY_CLIENTS || '').split(',').map((s) => s.trim()).filter(Boolean)];
  const clients = await liveClients({ db, legacyClients });
  if (!clients.length) throw new Error('No configured active client deployments were found');
  const main = await api('git/ref/heads/main');
  if (main.object?.sha !== env.GITHUB_SHA) throw new Error('Main advanced during console deployment; rerun rollout on the current main revision');
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
