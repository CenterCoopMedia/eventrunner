'use strict';

const { GITHUB_HEADERS, githubFetch, installationToken } = require('./buildDispatch.cjs');
const { ConsoleError } = require('./http.cjs');

// One cached page serves all sites for a minute. Completed job membership does
// not change, so reading a second site's history does not reread the same jobs.
const pages = new Map();
const completedJobs = new Map();
const live = (run) => run.status !== 'completed';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createDeploymentRuns({ env, privateKey, fetch, now = Date.now, wait = pause }) {
  const repository = env.CONSOLE_GITHUB_REPOSITORY || '';
  let token;
  async function api(path, body) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !env.CONSOLE_GITHUB_APP_ID || !env.CONSOLE_GITHUB_INSTALLATION_ID || !privateKey) {
      throw new ConsoleError(503, 'deployments-unavailable', 'Deployments is not connected to GitHub. Ask the hosting team to check the console settings.');
    }
    token ||= await installationToken({ appId: env.CONSOLE_GITHUB_APP_ID, installationId: env.CONSOLE_GITHUB_INSTALLATION_ID,
      privateKey, repository, permissions: { actions: 'write' }, fetch, now });
    const response = await githubFetch(fetch, 'deployments', `/repos/${repository}/actions/${path}`, {
      headers: { ...GITHUB_HEADERS, Authorization: `Bearer ${token}` },
      ...(body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : {}),
    });
    return response.status === 204 || response.status === 202 ? null : response.json();
  }

  async function clientsOf(run) {
    const manual = /^Deploy ([a-z0-9][a-z0-9-]{0,62})(?: \(bootstrap\))?(?: \[build \d+\])?$/.exec(run.display_title || '');
    if (run.event === 'workflow_dispatch') return manual ? [manual[1]] : [];
    if (run.event !== 'push' || run.head_branch !== 'main') return [];
    const key = `${repository}/${run.id}/${run.run_attempt}`;
    if (completedJobs.has(key)) return completedJobs.get(key);
    const clients = new Set();
    for (let page = 1; ; page += 1) {
      const result = await api(`runs/${run.id}/jobs?per_page=100&page=${page}`);
      for (const job of result.jobs) {
        const match = /^Deploy \(([a-z0-9][a-z0-9-]{0,62})\)\s*\//.exec(job.name);
        if (match) clients.add(match[1]);
      }
      if (result.jobs.length < 100) break;
    }
    const values = [...clients];
    if (!live(run)) {
      if (completedJobs.size >= 200) completedJobs.delete(completedJobs.keys().next().value);
      completedJobs.set(key, values);
    }
    return values;
  }

  async function list(page = 1) {
    const key = `${repository}/${page}`;
    const cached = pages.get(key);
    if (cached && now() - cached.at < 60_000) return cached.result;
    // Twenty global runs per page, including automatic main deploys. Older
    // runs remain accessible by pagination instead of implying a partial list is complete.
    const data = await api(`workflows/deploy.yml/runs?branch=main&per_page=20&page=${page}`);
    const runs = await Promise.all(data.workflow_runs.map(async (run) => {
      return { id: String(run.id), url: `https://github.com/${repository}/actions/runs/${run.id}`,
        status: run.status, conclusion: run.conclusion, startedAt: run.run_started_at || run.created_at,
        updatedAt: run.updated_at, clients: await clientsOf(run) };
    }));
    const result = { runs, nextPage: page * 20 < data.total_count ? page + 1 : null };
    if (pages.size >= 50) pages.delete(pages.keys().next().value);
    pages.set(key, { at: now(), result });
    return result;
  }

  async function stop(id) {
    const run = await api(`runs/${id}`);
    if (!live(run)) return;
    await api(`runs/${id}/cancel`, {});
    // A child may be dispatched until the parent actually stops. A bounded
    // failure leaves the control retryable; it never reports a completed stop.
    for (let poll = 0; poll < 12; poll += 1) {
      await wait(5000);
      if (!live(await api(`runs/${id}`))) return;
    }
    throw new ConsoleError(409, 'run-stopping', 'The run is still stopping. Wait a minute, then stop the build again.');
  }

  async function stopChildren({ environment, parentId, after }) {
    if (!Number.isFinite(Date.parse(after))) throw new ConsoleError(409, 'build-time-missing', 'The build has no start time; its deploy runs could not be checked.');
    const created = encodeURIComponent(`>=${after}`);
    const ids = [];
    for (let page = 1; ; page += 1) {
      const data = await api(`workflows/deploy.yml/runs?event=workflow_dispatch&branch=main&created=${created}&per_page=100&page=${page}`);
      for (const run of data.workflow_runs) {
        if (live(run) && [`Deploy ${environment} [build ${parentId}]`, `Deploy ${environment} (bootstrap) [build ${parentId}]`].includes(run.display_title)) ids.push(String(run.id));
      }
      if (data.workflow_runs.length < 100) break;
    }
    for (const id of ids) await stop(id);
  }

  return { repository, list, get: (id) => api(`runs/${id}`), stop, stopChildren,
    redeploy: (client) => api('workflows/deploy.yml/dispatches', { ref: 'main', inputs: { client } }) };
}

module.exports = { createDeploymentRuns };
