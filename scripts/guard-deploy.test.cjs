'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { main } = require('./guard-deploy.cjs');

const RUN = 'a'.repeat(40);
const NEWER = 'b'.repeat(40);
const OLDER = 'c'.repeat(40);
const env = {
  GITHUB_REPOSITORY: 'CenterCoopMedia/eventrunner',
  EVENT_DEPLOY_ENVIRONMENT: 'ncsummit',
  GITHUB_SHA: RUN,
  GITHUB_RUN_ID: '1234',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_STEP_SUMMARY: '/test-summary',
  GITHUB_TOKEN: 'test-token',
};
const deployment = (id, sha, environment = env.EVENT_DEPLOY_ENVIRONMENT) => ({
  id, sha, environment, created_at: new Date(1_700_000_000_000 + id * 1000).toISOString(),
});

async function guard({ rows = [], states = {}, jobs = {}, ancestry = [], fetchError, status = 200, jsonError, environment, envValues = {}, summaryError } = {}) {
  const calls = [];
  const messages = [];
  const git = [];
  const summaries = [];
  const code = await main({
    env: { ...env, ...(environment && { EVENT_DEPLOY_ENVIRONMENT: environment }), ...envValues },
    fetch: async (url, options) => {
      calls.push(url);
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      assert.equal(options.redirect, 'error');
      if (fetchError) throw new Error('sensitive transport error test-token');
      const api = new URL(url);
      const match = api.pathname.match(/\/deployments\/(\d+)\/statuses$/);
      const job = api.pathname.match(/\/actions\/jobs\/(\d+)$/);
      assert.equal(api.origin, 'https://api.github.com');
      if (!match && !job) {
        assert.equal(api.pathname, '/repos/CenterCoopMedia/eventrunner/deployments');
        assert.equal(api.searchParams.get('environment'), environment || env.EVENT_DEPLOY_ENVIRONMENT);
        assert.equal(api.searchParams.get('per_page'), '100');
      } else if (match) {
        assert.equal(api.searchParams.get('per_page'), '1');
      }
      const statuses = (id) => states[id] ?? [{ state: 'success' }];
      let body;
      if (job) {
        const id = Number(job[1]) - 2000;
        const state = statuses(id)[0]?.state;
        body = {
          id: Number(job[1]), run_id: id + 1000, head_sha: rows.find((row) => row.id === id).sha,
          name: environment === 'console' ? 'Deploy the console' : `Deploy (${env.EVENT_DEPLOY_ENVIRONMENT}) / Deploy hosting`,
          conclusion: ['success', 'inactive'].includes(state) ? 'success' : 'failure',
          steps: [], ...jobs[id],
        };
      } else if (match) {
        const id = Number(match[1]);
        body = statuses(id);
        if (Array.isArray(body)) body = body.map((item) => ({
          log_url: `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${id + 1000}/job/${id + 2000}`, ...item,
        }));
      } else {
        body = rows.slice((Number(api.searchParams.get('page')) - 1) * 100, Number(api.searchParams.get('page')) * 100);
      }
      return { ok: status === 200, json: async () => {
        if (jsonError) throw new Error('sensitive JSON error test-token');
        return body;
      } };
    },
    runGit: (command, args) => {
      assert.equal(command, 'git');
      git.push(args);
      assert.ok(ancestry.length, 'unexpected ancestry call');
      return { status: ancestry.shift() };
    },
    writeSummary: (file, text) => {
      assert.equal(file, env.GITHUB_STEP_SUMMARY);
      if (summaryError) throw new Error('Cannot write run summary');
      summaries.push(text);
    },
    log: { log: (message) => messages.push(message), error: (message) => messages.push(message) },
  });
  assert.ok(messages.every((message) => !message.includes('test-token')));
  return { code, calls, messages: messages.join('\n'), git, summaries };
}

test('a newer live descendant stops the run with target, both SHAs and run ID', async () => {
  const result = await guard({ rows: [deployment(1, NEWER)], ancestry: [0] });
  assert.equal(result.code, 1);
  assert.match(result.messages, /newer descendant is already live/);
  for (const value of ['environment=ncsummit', `live_sha=${NEWER}`, `run_sha=${RUN}`, 'run_id=1234']) {
    assert.ok(result.messages.includes(value));
  }
  assert.deepEqual(result.git, [['merge-base', '--is-ancestor', RUN, NEWER]]);
});

test('same-SHA redeploy proceeds without ancestry calls', async () => {
  const result = await guard({ rows: [deployment(1, RUN)] });
  assert.equal(result.code, 0);
  assert.deepEqual(result.git, []);
});

test('an older live ancestor permits a forward deploy', async () => {
  const result = await guard({ rows: [deployment(1, OLDER)], ancestry: [1, 0] });
  assert.equal(result.code, 0);
  assert.deepEqual(result.git, [
    ['merge-base', '--is-ancestor', RUN, OLDER],
    ['merge-base', '--is-ancestor', OLDER, RUN],
  ]);
});

test('an environment never deployed permits its first deploy', async () => {
  const result = await guard();
  assert.equal(result.code, 0);
  assert.match(result.messages, /live_sha=none/);
  assert.equal(result.calls.length, 1);
});

test('deployment API failures fail closed and redact response details', async () => {
  for (const options of [{ status: 403 }, { fetchError: true }, { jsonError: true }]) {
    const result = await guard(options);
    assert.equal(result.code, 1);
    assert.match(result.messages, /Deployment API/);
    assert.deepEqual(result.git, []);
  }
});

test('Git ancestry failures and diverged history fail closed', async () => {
  for (const ancestry of [[128], [null], [1, 128], [1, 1]]) {
    const result = await guard({ rows: [deployment(1, NEWER)], ancestry });
    assert.equal(result.code, 1);
    assert.match(result.messages, /Cannot verify Git ancestry|have diverged/);
  }
});

test('a failed post-deploy check cannot hide successful hosting at a newer SHA', async () => {
  const result = await guard({
    rows: [deployment(3, NEWER), deployment(2, NEWER), deployment(1, RUN)],
    states: { 3: [{ state: 'failure' }] },
    jobs: { 3: { name: 'Deploy (ncsummit) / Post-deploy smoke test' } },
    ancestry: [0],
  });
  assert.equal(result.code, 1);
  assert.ok(result.messages.includes(`deployment_sha=${NEWER}`));
  assert.ok(result.messages.includes(`live_sha=${RUN}`));
});

test('a newer group that failed before deploying does not block the live SHA', async () => {
  const result = await guard({
    rows: [deployment(3, NEWER), deployment(2, NEWER), deployment(1, RUN)],
    states: { 3: [{ state: 'failure' }] },
    jobs: { 3: { name: 'Deploy (ncsummit) / Deploy functions' }, 2: { name: 'Deploy (ncsummit) / Validate deploy-time environment' } },
  });
  assert.equal(result.code, 0);
  assert.deepEqual(result.git, []);
});

test('successful functions deploy counts even if its later migration failed', async () => {
  const result = await guard({
    rows: [deployment(2, NEWER), deployment(1, RUN)], states: { 2: [{ state: 'failure' }] },
    jobs: { 2: { name: 'Deploy (ncsummit) / Deploy functions', steps: [{ name: 'Deploy functions', conclusion: 'success' }] } },
    ancestry: [0],
  });
  assert.equal(result.code, 1);
});

test('a console rollout failure after its Deploy step still protects the deployed SHA', async () => {
  const result = await guard({
    environment: 'console', rows: [deployment(2, NEWER, 'console'), deployment(1, RUN, 'console')],
    states: { 2: [{ state: 'failure' }] }, jobs: { 2: { steps: [{ name: 'Deploy', conclusion: 'success' }] } }, ancestry: [0],
  });
  assert.equal(result.code, 1);
});

test('same SHA with an in-progress redeploy still permits redeployment', async () => {
  const result = await guard({
    rows: [deployment(3, RUN), deployment(2, RUN), deployment(1, OLDER)],
    states: { 3: [{ state: 'in_progress' }] }, ancestry: [1, 0],
  });
  assert.equal(result.code, 0);
});

test('inactive completed groups count as live and console uses its own environment', async () => {
  const result = await guard({
    environment: 'console', rows: [deployment(1, NEWER, 'console')],
    states: { 1: [{ state: 'inactive' }] }, ancestry: [0],
  });
  assert.equal(result.code, 1);
  assert.match(result.messages, /environment=console/);
});

test('status API errors and malformed or mismatched records fail closed', async () => {
  for (const options of [
    { rows: [deployment(1, NEWER, 'another-client')] },
    { rows: [{ ...deployment(1, NEWER), sha: 'invalid' }] },
    { rows: [deployment(1, NEWER)], states: { 1: {} } },
    { rows: [deployment(1, NEWER)], states: { 1: [{ state: 'unexpected' }] } },
    { rows: [deployment(1, NEWER), deployment(2, NEWER)] },
  ]) {
    assert.equal((await guard(options)).code, 1);
  }
  const result = await main({
    env, fetch: async (url) => ({
      ok: !url.includes('/statuses'),
      json: async () => [deployment(1, NEWER)],
    }), log: { log() {}, error() {} },
  });
  assert.equal(result, 1);
});

test('SHA groups span API pages and an exhausted history fails closed', async () => {
  const rows = Array.from({ length: 101 }, (_, i) => deployment(101 - i, NEWER));
  const result = await guard({ rows, states: { 1: [{ state: 'failure' }] }, ancestry: [0] });
  assert.equal(result.code, 1, 'successful production writes survive a failed job across the page boundary');
  assert.ok(result.messages.includes(`deployment_sha=${NEWER}`));
  assert.equal(result.calls.filter((url) => new URL(url).pathname.endsWith('/deployments')).length, 2);
  const exhausted = await guard({ rows: Array.from({ length: 300 }, (_, i) => deployment(300 - i, NEWER)) });
  assert.equal(exhausted.code, 1);
  assert.match(exhausted.messages, /history window/);
});

test('job API failures, missing links, and mismatched job identity fail closed', async () => {
  for (const options of [
    { jobs: { 1: { head_sha: OLDER } } },
    { jobs: { 1: { run_id: 999 } } },
    { states: { 1: [{ state: 'success', log_url: 'https://example.com/not-a-job' }] } },
  ]) {
    assert.equal((await guard({ rows: [deployment(1, NEWER)], ...options })).code, 1);
  }
  const code = await main({
    env, fetch: async (url) => ({
      ok: !url.includes('/actions/jobs/'),
      json: async () => url.includes('/statuses') ? [{ state: 'success', log_url: `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/1001/job/2001` }] : [deployment(1, NEWER)],
    }), log: { log() {}, error() {} },
  });
  assert.equal(code, 1);
});

test('an intentional rollback requires an explicit dispatch option and records its reason', async () => {
  const result = await guard({
    rows: [deployment(1, NEWER)], ancestry: [0],
    envValues: { EVENT_ALLOW_OLDER_SHA: 'true', EVENT_ROLLBACK_REASON: 'Restore registration during outage' },
  });
  assert.equal(result.code, 0);
  assert.equal(result.summaries.length, 1);
  assert.match(result.summaries[0], /Restore registration during outage/);
  for (const value of [NEWER, RUN, 'run_id=1234', 'environment=ncsummit']) assert.ok(result.summaries[0].includes(value));
});

test('invalid rollback requests and failed summary writes cannot bypass the guard', async () => {
  for (const envValues of [
    { EVENT_ALLOW_OLDER_SHA: 'true' },
    { EVENT_ALLOW_OLDER_SHA: 'true', EVENT_ROLLBACK_REASON: '  ' },
    { EVENT_ALLOW_OLDER_SHA: 'true', EVENT_ROLLBACK_REASON: 'outage', GITHUB_EVENT_NAME: 'push' },
    { EVENT_ALLOW_OLDER_SHA: 'true', EVENT_ROLLBACK_REASON: 'outage', GITHUB_STEP_SUMMARY: '' },
    { EVENT_ALLOW_OLDER_SHA: 'true', EVENT_ROLLBACK_REASON: 'outage\n::notice::injected' },
    { EVENT_ALLOW_OLDER_SHA: 'yes', EVENT_ROLLBACK_REASON: 'outage' },
  ]) {
    const result = await guard({ rows: [deployment(1, NEWER)], envValues });
    assert.equal(result.code, 1);
    assert.deepEqual(result.summaries, []);
  }
  const result = await guard({
    rows: [deployment(1, NEWER)], ancestry: [0], summaryError: true,
    envValues: { EVENT_ALLOW_OLDER_SHA: 'true', EVENT_ROLLBACK_REASON: 'outage' },
  });
  assert.equal(result.code, 1);
  const unavailable = await guard({
    status: 503, envValues: { EVENT_ALLOW_OLDER_SHA: 'true', EVENT_ROLLBACK_REASON: 'outage' },
  });
  assert.equal(unavailable.code, 1, 'rollback must still verify deployment state');
});

test('workflow guards execute before production writes with read-only deployment access', () => {
  const workflow = (name) => fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', name), 'utf8').replace(/\r\n/g, '\n');
  const client = workflow('deploy-client.yml');
  const caller = workflow('deploy.yml');
  const consoleWorkflow = workflow('deploy-console.yml');
  const guardJob = client.slice(client.indexOf('\n  guard:'), client.indexOf('\n  changes:'));
  assert.match(guardJob, /EVENT_DEPLOY_ENVIRONMENT: \$\{\{ inputs\.client \}\}/);
  assert.match(guardJob, /run: node scripts\/guard-deploy\.cjs/);
  assert.match(guardJob, /fetch-depth: 0/);
  for (const name of ['provision', 'functions', 'publisher', 'hosting', 'post']) {
    const body = client.split(`\n  ${name}:\n`)[1].split(/\n {2}[a-z-]+:\n/)[0];
    assert.match(body, /needs: \[[^\]\n]*guard[^\]\n]*\]/);
  }
  assert.match(client, /needs\.guard\.result == 'success'/);
  for (const text of [client, caller, consoleWorkflow]) assert.match(text, /deployments: read/);
  for (const text of [client, caller]) assert.match(text, /actions: read/);
  for (const text of [client, caller, consoleWorkflow]) {
    assert.match(text, /allow_older_sha:/);
    assert.match(text, /rollback_reason:/);
  }
  for (const text of [client, consoleWorkflow]) {
    assert.match(text, /EVENT_ALLOW_OLDER_SHA: \$\{\{ inputs\.allow_older_sha \}\}/);
    assert.match(text, /EVENT_ROLLBACK_REASON: \$\{\{ inputs\.rollback_reason \}\}/);
  }
  assert.match(caller, /allow_older_sha: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.allow_older_sha \|\| false \}\}/);
  const guardAt = consoleWorkflow.indexOf('run: node scripts/guard-deploy.cjs');
  assert.ok(guardAt > 0 && guardAt < consoleWorkflow.indexOf('run: npm run prepare:functions'));
  assert.match(consoleWorkflow.slice(0, guardAt), /EVENT_DEPLOY_ENVIRONMENT: console/);
  assert.match(consoleWorkflow.slice(0, guardAt), /fetch-depth: 0/);
  assert.doesNotMatch(guardJob + consoleWorkflow, /continue-on-error:/);
});
