'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  CONNECTOR_APP_ID,
  CONNECTOR_LOGIN,
  CONNECTOR_USER_ID,
  SUMMARY_MARKER,
  inspectConnectorReview,
  isCurrentCompletedSummary,
  waitForConnectorReview,
} = require('./connector-review.cjs');

const HEAD_SHA = 'abcdef1234567890abcdef1234567890abcdef12';

function summaryBody(commit, status = '✅ **Completed**') {
  return `${SUMMARY_MARKER}\n\n| Review | Status | Commit | Review trigger |\n| --- | --- | --- | --- |\n| 📝 **Code Review** | ${status} | \`${commit}\` | PR opened |`;
}

function connectorComment(overrides = {}) {
  return {
    id: 10,
    updated_at: '2026-09-11T12:00:00Z',
    user: { login: CONNECTOR_LOGIN, id: CONNECTOR_USER_ID },
    performed_via_github_app: { id: CONNECTOR_APP_ID },
    body: summaryBody(HEAD_SHA.slice(0, 7)),
    ...overrides,
  };
}

function eventContext(headSha = HEAD_SHA) {
  return {
    repo: { owner: 'owner', repo: 'repository' },
    payload: { pull_request: { number: 42, head: { sha: headSha } } },
  };
}

function threadPage(nodes, hasNextPage = false, endCursor = null) {
  return {
    repository: {
      pullRequest: {
        reviewThreads: {
          nodes,
          pageInfo: { hasNextPage, endCursor },
        },
      },
    },
  };
}

function fakeGithub({ actualHead = HEAD_SHA, comments = [], threadPages = [] } = {}) {
  const calls = { pulls: [], comments: [], graphql: [] };
  const listComments = async () => {
    throw new Error('paginate must control issue comment pagination');
  };
  let threadPageIndex = 0;
  const github = {
    rest: {
      pulls: {
        get: async (options) => {
          calls.pulls.push(options);
          const sha = typeof actualHead === 'function' ? actualHead(calls.pulls.length) : actualHead;
          return { data: { head: { sha } } };
        },
      },
      issues: { listComments },
    },
    paginate: async (method, options) => {
      assert.equal(method, listComments);
      calls.comments.push(options);
      return comments.flat();
    },
    graphql: async (query, variables) => {
      calls.graphql.push({ query, variables });
      const page = threadPages[threadPageIndex];
      threadPageIndex += 1;
      return page;
    },
  };
  return { github, calls };
}

test('accepts the trusted completed summary for a matching SHA prefix', () => {
  assert.equal(isCurrentCompletedSummary(connectorComment(), HEAD_SHA), true);
  assert.equal(
    isCurrentCompletedSummary(
      connectorComment({ performed_via_github_app: undefined, body: summaryBody(HEAD_SHA) }),
      HEAD_SHA,
    ),
    true,
  );
});

test('rejects stale, unfinished, and error summary rows', () => {
  assert.equal(isCurrentCompletedSummary(connectorComment({ body: summaryBody('1234567') }), HEAD_SHA), false);
  assert.equal(
    isCurrentCompletedSummary(connectorComment({ body: summaryBody(HEAD_SHA.slice(0, 7), '👀 **In progress**') }), HEAD_SHA),
    false,
  );
  assert.equal(
    isCurrentCompletedSummary(connectorComment({ body: summaryBody(HEAD_SHA.slice(0, 7), '❌ **Error**') }), HEAD_SHA),
    false,
  );
});

test('rejects forged connector identities and a wrong GitHub App id', () => {
  const wrongLogin = connectorComment({ user: { login: 'attacker[bot]', id: CONNECTOR_USER_ID } });
  const wrongUserId = connectorComment({ user: { login: CONNECTOR_LOGIN, id: 1 } });
  const wrongAppId = connectorComment({ performed_via_github_app: { id: 1 } });

  assert.equal(isCurrentCompletedSummary(wrongLogin, HEAD_SHA), false);
  assert.equal(isCurrentCompletedSummary(wrongUserId, HEAD_SHA), false);
  assert.equal(isCurrentCompletedSummary(wrongAppId, HEAD_SHA), false);
});

test('passes from a paginated summary and requires every review thread to be resolved', async () => {
  const forged = connectorComment({ user: { login: CONNECTOR_LOGIN, id: 1 } });
  const { github, calls } = fakeGithub({
    comments: [[forged], [connectorComment()]],
    threadPages: [
      threadPage([{ isResolved: true, isOutdated: false }], true, 'next-page'),
      threadPage([{ isResolved: true, isOutdated: true }]),
    ],
  });

  const result = await inspectConnectorReview({
    github,
    owner: 'owner',
    repo: 'repository',
    pullNumber: 42,
    expectedHeadSha: HEAD_SHA,
  });

  assert.equal(result.ready, true);
  assert.equal(result.threadCount, 2);
  assert.equal(calls.comments.length, 1);
  assert.equal(calls.comments[0].per_page, 100);
  assert.equal(calls.graphql.length, 2);
  assert.equal(calls.graphql[0].variables.cursor, null);
  assert.equal(calls.graphql[1].variables.cursor, 'next-page');
});

test('waits while an outdated finding is unresolved, then passes when it resolves', async () => {
  const { github, calls } = fakeGithub({
    comments: [[connectorComment()]],
    threadPages: [
      threadPage([{ isResolved: false, isOutdated: true }]),
      threadPage([{ isResolved: true, isOutdated: true }]),
    ],
  });
  let currentTime = 0;
  const sleeps = [];

  const result = await waitForConnectorReview({
    github,
    context: eventContext(),
    log: { info() {} },
    now: () => currentTime,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      currentTime += milliseconds;
    },
    pollIntervalMs: 20,
    maxWaitMs: 40,
  });

  assert.equal(result.ready, true);
  assert.deepEqual(sleeps, [20]);
  assert.equal(calls.pulls.length, 2);
  assert.equal(calls.comments.length, 2);
});

test('fails closed after the wait when no current completed summary appears', async () => {
  const { github } = fakeGithub({ comments: [[connectorComment({ body: summaryBody('1234567') })]] });
  let currentTime = 0;

  await assert.rejects(
    waitForConnectorReview({
      github,
      context: eventContext(),
      log: { info() {} },
      now: () => currentTime,
      sleep: async (milliseconds) => {
        currentTime += milliseconds;
      },
      pollIntervalMs: 20,
      maxWaitMs: 20,
    }),
    /did not complete: no completed Codex summary for the current head/,
  );
});

test('fails immediately when the current pull request head differs from the event head', async () => {
  const changedHead = '1234567890abcdef1234567890abcdef12345678';
  const { github, calls } = fakeGithub({ actualHead: changedHead });

  await assert.rejects(
    waitForConnectorReview({
      github,
      context: eventContext(),
      log: { info() {} },
      sleep: async () => assert.fail('must not sleep after a head change'),
    }),
    new RegExp(`head changed from ${HEAD_SHA} to ${changedHead}`),
  );
  assert.equal(calls.comments.length, 0);
  assert.equal(calls.graphql.length, 0);
});

test('workflow has only the requested read-only pull request triggers', () => {
  const workflowPath = path.resolve(__dirname, '..', '..', '.github', 'workflows', 'connector-review.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /^name: Connector review$/m);
  assert.match(workflow, /pull_request:\n\s+types: \[opened, synchronize, reopened, ready_for_review\]/);
  assert.match(workflow, /pull_request_review:\n\s+types: \[submitted, edited, dismissed\]/);
  assert.doesNotMatch(workflow, /^\s*push:/m);
  assert.match(workflow, /permissions:\n\s+contents: read\n\s+pull-requests: read\n\s+issues: read/);
  assert.match(workflow, /name: Connector review[\s\S]*timeout-minutes: 30/);
  assert.match(workflow, /actions\/checkout@v4[\s\S]*actions\/github-script@v7/);
  assert.doesNotMatch(workflow, /statuses: write|checks: write|createComment|requestReviewers|createCommitStatus/);
});
