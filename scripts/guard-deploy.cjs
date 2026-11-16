'use strict';

const { spawnSync } = require('node:child_process');
const { appendFileSync } = require('node:fs');

const SHA = /^[0-9a-f]{40}$/;

// Use the live-state reader's deployment records, SHA groups and history bound.
// Also retain successful production writes in incomplete groups: a later smoke
// failure does not undo hosting or functions. Pre-deploy successes do not count.
async function readLiveState({ repository, environment, read }) {
  async function* deployments() {
    let previous;
    for (let page = 1; page <= 3; page += 1) {
      const rows = await read(`/repos/${repository}/deployments?environment=${encodeURIComponent(environment)}&per_page=100&page=${page}`);
      if (!Array.isArray(rows) || rows.length > 100) throw new Error('Invalid deployment history');
      for (const row of rows) {
        if (!Number.isSafeInteger(row.id) || row.id <= 0 || !SHA.test(row.sha) ||
            row.environment !== environment || !Number.isFinite(Date.parse(row.created_at)) ||
            (previous && (row.id >= previous.id || Date.parse(row.created_at) > Date.parse(previous.created_at)))) {
          throw new Error('Cannot verify deployment identity or history order');
        }
        previous = row;
        yield row;
      }
      if (rows.length < 100) return;
    }
    throw new Error('Cannot verify live SHA within deployment history window');
  }

  let sha = '';
  let successful = true;
  let wroteProduction = false;
  const partialSHAs = new Set();
  const finishGroup = () => {
    if (sha && wroteProduction && !successful) partialSHAs.add(sha);
    return sha && wroteProduction && successful;
  };
  for await (const deployment of deployments()) {
    if (deployment.sha !== sha) {
      if (finishGroup()) return { liveSHA: sha, partialSHAs };
      sha = deployment.sha;
      successful = true;
      wroteProduction = false;
    }
    const statuses = await read(`/repos/${repository}/deployments/${deployment.id}/statuses?per_page=1`);
    if (!Array.isArray(statuses) || statuses.length > 1) throw new Error('Invalid deployment status response');
    const state = statuses[0]?.state;
    if (state !== 'success' && state !== 'inactive') {
      if (statuses.length !== 0 && !['failure', 'error', 'queued', 'in_progress', 'pending', 'waiting'].includes(state)) {
        throw new Error('Cannot verify deployment status');
      }
      successful = false;
    }
    if (wroteProduction || statuses.length === 0 || ['queued', 'pending', 'waiting'].includes(state)) continue;
    const prefix = `https://github.com/${repository}/actions/runs/`;
    const link = statuses[0].log_url;
    const match = typeof link === 'string' && link.startsWith(prefix) && link.slice(prefix.length).match(/^([0-9]+)\/job\/([0-9]+)$/);
    if (!match) throw new Error('Cannot identify deployment job');
    const job = await read(`/repos/${repository}/actions/jobs/${match[2]}`);
    if (job.id !== Number(match[2]) || job.run_id !== Number(match[1]) || job.head_sha !== sha || typeof job.name !== 'string') {
      throw new Error('Cannot verify deployment job identity');
    }
    const clientJob = [`Deploy (${environment}) / Deploy hosting`, `Deploy (${environment}) / Deploy functions`].includes(job.name);
    const consoleJob = environment === 'console' && job.name === 'Deploy the console';
    if (!clientJob && !consoleJob) continue;
    // A console rollout or a functions migration can fail after firebase deploy.
    const deployStep = consoleJob ? 'Deploy' : job.name.endsWith(' / Deploy hosting') ? 'Deploy hosting' : 'Deploy functions';
    wroteProduction = job.conclusion === 'success' ||
      (Array.isArray(job.steps) && job.steps.some((step) => step.name === deployStep && step.conclusion === 'success'));
  }
  return { liveSHA: finishGroup() ? sha : '', partialSHAs };
}

async function main({ env = process.env, fetch = globalThis.fetch, runGit = spawnSync, writeSummary = appendFileSync, log = console } = {}) {
  const repository = env.GITHUB_REPOSITORY;
  const environment = env.EVENT_DEPLOY_ENVIRONMENT;
  const runSHA = env.GITHUB_SHA;
  const runID = env.GITHUB_RUN_ID;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '') ||
      !/^[A-Za-z0-9_-]+$/.test(environment || '') || !SHA.test(runSHA || '') || !/^[0-9]+$/.test(runID || '')) {
    log.error('Deploy guard refused: invalid repository, environment, run SHA or run ID');
    return 1;
  }
  let liveSHA = 'unknown';
  const context = () => `environment=${environment} live_sha=${liveSHA || 'none'} run_sha=${runSHA} run_id=${runID}`;
  try {
    const allowOlder = env.EVENT_ALLOW_OLDER_SHA === 'true';
    if (!['', 'false', 'true'].includes(env.EVENT_ALLOW_OLDER_SHA || '')) throw new Error('Invalid rollback option');
    const reason = (env.EVENT_ROLLBACK_REASON || '').trim();
    if (allowOlder && (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || !reason || reason.length > 500 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(reason) || !env.GITHUB_STEP_SUMMARY)) {
      throw new Error('Intentional rollback requires workflow_dispatch, a one-line reason (1-500 characters), and a run summary');
    }
    if (!env.GITHUB_TOKEN) throw new Error('Deployment API token is unavailable');
    const read = async (endpoint) => {
      let response;
      try {
        response = await fetch(`https://api.github.com${endpoint}`, {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${env.GITHUB_TOKEN}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
          redirect: 'error',
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        throw new Error('Deployment API request failed');
      }
      if (!response.ok) throw new Error('Deployment API returned an unsuccessful response');
      try {
        return await response.json();
      } catch {
        throw new Error('Deployment API returned invalid JSON');
      }
    };
    const live = await readLiveState({ repository, environment, read });
    liveSHA = live.liveSHA;
    for (const deployedSHA of new Set([...live.partialSHAs, liveSHA].filter(Boolean))) {
      if (deployedSHA === runSHA) continue;
      const isAncestor = (base, head) => {
        const result = runGit('git', ['merge-base', '--is-ancestor', base, head], { encoding: 'utf8' });
        if (result.error || ![0, 1].includes(result.status)) throw new Error('Cannot verify Git ancestry');
        return result.status === 0;
      };
      if (isAncestor(runSHA, deployedSHA)) {
        if (!allowOlder) {
          log.error(`Deploy guard refused: a newer descendant is already live or has successful production writes; deployment_sha=${deployedSHA} ${context()}`);
          return 1;
        }
      } else if (!isAncestor(deployedSHA, runSHA)) {
        throw new Error('Live and run SHAs have diverged');
      }
    }
    if (allowOlder) {
      writeSummary(env.GITHUB_STEP_SUMMARY, `Intentional rollback enabled: ${context()}\n\nReason: ${JSON.stringify(reason)}\n`);
      log.log(`Intentional rollback enabled; reason=${JSON.stringify(reason)}; ${context()}`);
    }
    log.log(`Deploy guard passed; ${context()}`);
    return 0;
  } catch (error) {
    log.error(`Deploy guard refused: ${error.message}; ${context()}`);
    return 1;
  }
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; });
}

module.exports = { main };
