'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { RULESET_PATTERN, stripAttribution, cleanText, run } = require('./no-ai-attribution.cjs');
const history = require('./fixtures/attribution-history.json');

const credit = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';
const session = 'Claude-Session: https://claude.ai/code/session_018gBJRkNQJGcw4SNsJ7AzQa';

test('removes real attribution from main commit 31f9455c, retaining all other bytes', () => {
  assert.equal(history.commit, '31f9455cd89a29ddce94f2b5efef9b1bf155dc86');
  assert.ok(history.body.includes(credit));
  assert.ok(history.body.includes(session));
  const expected = history.body.split('\n').filter((line) =>
    line !== credit && line !== session &&
    line !== 'Co-authored-by: Claude Opus 5.5 <noreply@anthropic.com>').join('\n');
  const cleaned = stripAttribution(history.body);
  assert.equal(cleaned, expected);
  assert.ok(cleaned.includes('each traced against the Hosting v1beta1 API:'));
  assert.equal((cleaned.match(/Signed-off-by:/g) || []).length, 3);
  assert.equal(stripAttribution(cleaned), cleaned);
});

test('uses every provider and form in the exact server ruleset pattern', () => {
  assert.ok(RULESET_PATTERN.startsWith('(?im)'));
  for (const provider of ['claude', 'anthropic', 'openai', 'codex', 'chatgpt', 'gemini', 'copilot', 'cursor', 'grok', 'kimi']) {
    assert.equal(stripAttribution(`Co-authored-by: ${provider} <test@example.com>`), '');
  }
  for (const provider of ['claude', 'openai', 'codex', 'chatgpt', 'gemini', 'copilot', 'cursor', 'grok', 'kimi']) {
    for (const verb of ['with', 'by']) {
      assert.equal(stripAttribution(`🤖 Generated ${verb} [${provider}](https://example.com)`), '');
    }
  }
  for (const address of ['noreply@anthropic.com', 'noreply@openai.com']) {
    assert.equal(stripAttribution(`Credit: ${address}`), '');
  }
  assert.equal(stripAttribution('CLAUDE-SESSION: a session'), '');
});

test('ordinary model mentions, human trailers and untrusted shell/Actions text stay literal', () => {
  const ordinary = [
    'Claude and Codex are supported clients.',
    'Review the Claude configuration and Codex instructions.',
    'Co-authored-by: Human Maintainer <human@example.com>',
    'Signed-off-by: Joe Amditis <6799804+jamditis@users.noreply.github.com>',
    'noreply@openaiXcom is not the matched address.',
    'A generated report can describe Claude.',
    '$(touch /tmp/attribution-injection) `echo data` ${{ secrets.GITHUB_TOKEN }}',
    '::error::this remains data',
  ].join('\r\n');
  assert.equal(stripAttribution(ordinary), ordinary);
});

test('preserves retained line endings, blank lines and missing final newline', () => {
  assert.equal(stripAttribution(`first\r\n${credit}\r\n\r\nlast`), 'first\r\n\r\nlast');
  assert.equal(stripAttribution(`first\n${session}\nlast\n`), 'first\nlast\n');
  assert.equal(stripAttribution(`first\r${credit}\rlast`), 'first\rlast');
  assert.equal(stripAttribution(''), '');
});

function harness(eventName, current, authorType = 'User') {
  const state = { current: { ...current }, writes: [], failures: [], notices: [] };
  const repo = { owner: 'CenterCoopMedia', repo: 'eventrunner' };
  const get = async (params) => {
    assert.equal(params.owner, repo.owner);
    assert.equal(params.repo, repo.repo);
    return { data: { ...state.current } };
  };
  const update = async (params) => {
    state.writes.push(params);
    for (const key of ['title', 'body']) {
      if (Object.hasOwn(params, key)) state.current[key] = params[key];
    }
  };
  const github = { rest: {
    issues: { get, update, getComment: get, updateComment: update },
    pulls: { get, update, getReview: get, updateReview: update, getReviewComment: get, updateReviewComment: update },
  } };
  const context = { repo, eventName, payload: {
    pull_request: { number: 123, title: 'stale', body: 'stale' },
    issue: { number: 456 }, comment: { id: 789 }, review: { id: 987 },
    sender: { type: authorType, login: 'untrusted-author' },
  } };
  const core = {
    setFailed: (message) => state.failures.push(message),
    notice: (message) => state.notices.push(message),
  };
  return { state, github, context, core };
}

for (const event of ['pull_request_target', 'issues', 'issue_comment', 'pull_request_review_comment', 'pull_request_review']) {
  for (const author of ['User', 'Bot']) {
    test(`${event}: cleans current text for ${author}, then makes no second edit`, async () => {
      const h = harness(event, { title: 'Support Claude and Codex', body: `Keep this.\n${credit}\nKeep that.` }, author);
      await run(h);
      assert.equal(h.state.current.body, 'Keep this.\nKeep that.');
      assert.equal(h.state.current.title, 'Support Claude and Codex');
      assert.equal(h.state.writes.length, 1);
      assert.equal(h.state.notices.length, 1);
      assert.deepEqual(h.state.failures, []);
      const write = h.state.writes[0];
      if (event === 'pull_request_target') assert.equal(write.pull_number, 123);
      else if (event === 'issues') assert.equal(write.issue_number, 456);
      else if (event === 'pull_request_review') {
        assert.equal(write.pull_number, 123);
        assert.equal(write.review_id, 987);
      } else assert.equal(write.comment_id, 789);
      await run(h);
      assert.equal(h.state.writes.length, 1);
      assert.equal(h.state.notices.length, 1);
    });
  }
}

test('title consisting of attribution fails while body cleanup still runs', async () => {
  const h = harness('pull_request_target', { title: 'Generated with Codex', body: `${credit}\nUseful.` });
  await run(h);
  assert.equal(h.state.current.title, 'Generated with Codex');
  assert.equal(h.state.current.body, 'Useful.');
  assert.ok(h.state.failures.length);
  assert.ok(!Object.hasOwn(h.state.writes[0], 'title'));
});

test('empty PR/issue body is allowed; attribution-only comments/reviews receive an invisible marker', async () => {
  for (const event of ['pull_request_target', 'issues', 'issue_comment', 'pull_request_review_comment', 'pull_request_review']) {
    const h = harness(event, { title: 'Meaningful title', body: credit });
    await run(h);
    assert.equal(h.state.current.body, ['issues', 'pull_request_target'].includes(event) ? '' : '<!-- attribution removed -->');
    assert.deepEqual(h.state.failures, []);
  }
});

test('post-edit readback fails if attribution remains', async () => {
  const failures = [];
  await cleanText({
    get: async () => ({ data: { body: credit } }),
    update: async () => {}, fields: ['body'], needsBody: true,
    core: { setFailed: (message) => failures.push(message), notice: () => {} },
  });
  assert.equal(failures.length, 1);
});

test('read-only fork token failure is visible without echoing server/user text', async () => {
  const h = harness('pull_request_review', { body: credit });
  h.github.rest.pulls.updateReview = async () => {
    throw Object.assign(new Error('untrusted response text'), { status: 403 });
  };
  await run(h);
  assert.deepEqual(h.state.failures, ['Attribution cleanup could not complete (HTTP 403).']);
  assert.deepEqual(h.state.notices, []);
});

test('broad server-pattern matches are disclosed by count without logging submitted prose', async () => {
  const prose = 'The next page is generated by the Firestore query cursor';
  const h = harness('issue_comment', { body: `Keep this.\n${prose}\n${credit}` });
  await run(h);
  assert.equal(h.state.current.body, 'Keep this.\n');
  assert.deepEqual(h.state.notices, [
    'Removed 2 attribution-matching line(s) from body. Review the GitHub edit history to recover any unintended match.',
  ]);
  assert.ok(!h.state.notices.join('').includes(prose));
});

test('clean and null bodies cause no write', async () => {
  for (const body of [null, '', 'Codex and Claude configuration']) {
    const h = harness('issue_comment', { body });
    await run(h);
    assert.equal(h.state.writes.length, 0);
    assert.deepEqual(h.state.failures, []);
  }
});

test('workflow fetches only trusted default-branch code and never interpolates submitted text', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../../.github/workflows/no-ai-attribution.yml'), 'utf8');
  assert.ok(workflow.includes('pull_request_target:'));
  assert.ok(!/\n {2}pull_request:/.test(workflow));
  assert.ok(!workflow.includes('actions/checkout'));
  assert.ok(workflow.includes('branch: context.payload.repository.default_branch'));
  assert.ok(workflow.includes('ref: branch.commit.sha'));
  assert.ok(!workflow.includes('context.sha,'));
  const script = workflow.split('          script: |\n')[1];
  assert.ok(script);
  assert.ok(!script.includes('${{'));
  assert.ok(!workflow.includes('github.actor'));
});
