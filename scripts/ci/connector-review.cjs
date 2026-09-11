'use strict';

const CONNECTOR_LOGIN = 'chatgpt-codex-connector[bot]';
const CONNECTOR_USER_ID = 199175422;
const CONNECTOR_APP_ID = 1144995;
const SUMMARY_MARKER = '<!-- codex-pull-request-review-summary -->';
const POLL_INTERVAL_MS = 20 * 1000;
const MAX_WAIT_MS = 25 * 60 * 1000;

const REVIEW_THREADS_QUERY = `
  query ConnectorReviewThreads(
    $owner: String!
    $repo: String!
    $number: Int!
    $cursor: String
  ) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100, after: $cursor) {
          nodes {
            isResolved
            isOutdated
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

function isTrustedConnectorComment(comment) {
  if (comment?.user?.login !== CONNECTOR_LOGIN) return false;
  if (Number(comment.user.id) !== CONNECTOR_USER_ID) return false;
  const app = comment.performed_via_github_app;
  return !app || Number(app.id) === CONNECTOR_APP_ID;
}

function codeReviewRow(body) {
  if (typeof body !== 'string' || !body.includes(SUMMARY_MARKER)) return null;
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('|') && line.endsWith('|') && /\bCode\s+Review\b/i.test(line));
}

function isCurrentCompletedSummary(comment, headSha) {
  if (!isTrustedConnectorComment(comment) || !/^[0-9a-f]{40}$/i.test(headSha)) return false;
  const row = codeReviewRow(comment.body);
  if (!row || !/\bCompleted\b/i.test(row)) return false;
  if (/\b(?:in\s+progress|error|failed|failure|pending|queued|unfinished|cancelled|canceled)\b/i.test(row)) {
    return false;
  }
  const commitPrefixes = [...row.matchAll(/`([0-9a-f]{7,40})`/gi)].map((match) => match[1]);
  return commitPrefixes.some((prefix) => headSha.toLowerCase().startsWith(prefix.toLowerCase()));
}

function latestConnectorSummary(comments) {
  const summaries = comments.filter(
    (comment) => isTrustedConnectorComment(comment) && comment.body?.includes(SUMMARY_MARKER),
  );
  return summaries.reduce((latest, comment) => {
    if (!latest) return comment;
    const latestTime = Date.parse(latest.updated_at || latest.created_at || '') || 0;
    const commentTime = Date.parse(comment.updated_at || comment.created_at || '') || 0;
    return commentTime >= latestTime ? comment : latest;
  }, null);
}

async function listReviewThreads({ github, owner, repo, pullNumber }) {
  const threads = [];
  let cursor = null;

  do {
    const response = await github.graphql(REVIEW_THREADS_QUERY, {
      owner,
      repo,
      number: pullNumber,
      cursor,
    });
    const connection = response?.repository?.pullRequest?.reviewThreads;
    if (!connection || !Array.isArray(connection.nodes) || !connection.pageInfo) {
      throw new Error('GitHub returned an invalid review thread response.');
    }
    threads.push(...connection.nodes);
    if (connection.pageInfo.hasNextPage && !connection.pageInfo.endCursor) {
      throw new Error('GitHub omitted the next review thread cursor.');
    }
    cursor = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (cursor);

  return threads;
}

async function inspectConnectorReview({ github, owner, repo, pullNumber, expectedHeadSha }) {
  const pullResponse = await github.rest.pulls.get({ owner, repo, pull_number: pullNumber });
  const currentHeadSha = pullResponse?.data?.head?.sha;
  if (currentHeadSha !== expectedHeadSha) {
    throw new Error(`Pull request head changed from ${expectedHeadSha} to ${currentHeadSha || 'unknown'}.`);
  }

  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: pullNumber,
    per_page: 100,
  });
  const summary = latestConnectorSummary(comments);
  if (!summary || !isCurrentCompletedSummary(summary, expectedHeadSha)) {
    return { ready: false, reason: 'no completed Codex summary for the current head' };
  }

  // The connector displays a short SHA even for a clean review. Bind that
  // display value to GitHub's immutable full-SHA PR run records created
  // before completion. CI must keep an unfiltered pull_request trigger so
  // every reviewed head has a record. A second head with the same prefix is ambiguous,
  // and a head first pushed after completion has no qualifying receipt.
  const row = codeReviewRow(summary.body);
  const reviewed = [...row.matchAll(/`([0-9a-f]{7,40})`/gi)].map((match) => match[1].toLowerCase());
  const completedAt = row.match(/datetime="([^"]+)"/)?.[1];
  if (!completedAt || !Number.isFinite(Date.parse(completedAt))) {
    return { ready: false, reason: 'connector completion has no timestamp' };
  }
  const runs = await github.paginate(github.rest.actions.listWorkflowRunsForRepo, {
    owner, repo, event: 'pull_request', branch: pullResponse.data.head.ref,
    created: `<=${completedAt}`, per_page: 100,
  });
  const candidates = new Set(runs.filter((run) =>
    run.pull_requests?.some((pr) => pr.number === pullNumber) &&
    /^[0-9a-f]{40}$/i.test(run.head_sha) &&
    Date.parse(run.created_at) <= Date.parse(completedAt) &&
    reviewed.some((prefix) => run.head_sha.toLowerCase().startsWith(prefix))
  ).map((run) => run.head_sha.toLowerCase()));
  if (runs.length >= 1000 || candidates.size !== 1 || !candidates.has(expectedHeadSha.toLowerCase())) {
    return { ready: false, reason: 'connector receipt does not identify one full reviewed PR head' };
  }

  const threads = await listReviewThreads({ github, owner, repo, pullNumber });
  const unresolvedCount = threads.filter((thread) => thread?.isResolved !== true).length;
  if (unresolvedCount > 0) {
    return { ready: false, reason: `${unresolvedCount} unresolved review thread(s)` };
  }

  return { ready: true, summary, threadCount: threads.length };
}

function eventCoordinates(context) {
  const pullRequest = context?.payload?.pull_request;
  const owner = context?.repo?.owner;
  const repo = context?.repo?.repo;
  const pullNumber = pullRequest?.number;
  const expectedHeadSha = pullRequest?.head?.sha;
  if (!owner || !repo || !Number.isInteger(pullNumber) || !/^[0-9a-f]{40}$/i.test(expectedHeadSha)) {
    throw new Error('The workflow event does not contain a valid pull request and head SHA.');
  }
  return { owner, repo, pullNumber, expectedHeadSha };
}

async function waitForConnectorReview({
  github,
  context,
  log = console,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = Date.now,
  pollIntervalMs = POLL_INTERVAL_MS,
  maxWaitMs = MAX_WAIT_MS,
}) {
  const coordinates = eventCoordinates(context);
  const deadline = now() + maxWaitMs;

  while (true) {
    const result = await inspectConnectorReview({ github, ...coordinates });
    if (result.ready) {
      log.info(`Connector review passed for ${coordinates.expectedHeadSha}.`);
      return result;
    }
    if (now() >= deadline) {
      throw new Error(`Connector review did not complete: ${result.reason}.`);
    }
    log.info(`Connector review pending: ${result.reason}.`);
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - now())));
  }
}

module.exports = {
  CONNECTOR_APP_ID,
  CONNECTOR_LOGIN,
  CONNECTOR_USER_ID,
  MAX_WAIT_MS,
  POLL_INTERVAL_MS,
  SUMMARY_MARKER,
  inspectConnectorReview,
  isCurrentCompletedSummary,
  isTrustedConnectorComment,
  listReviewThreads,
  waitForConnectorReview,
};
