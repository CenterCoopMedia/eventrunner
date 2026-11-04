'use strict';

// Exact pattern from repository ruleset 26508211 (2026-11-03).
const RULESET_PATTERN = "(?im)(^co-authored-by:.*(claude|anthropic|openai|codex|chatgpt|gemini|copilot|cursor|grok|kimi)|^claude-session:|generated (with|by) .*(claude|openai|codex|chatgpt|gemini|copilot|cursor|grok|kimi)|noreply@anthropic\\.com|noreply@openai\\.com)";
const attribution = new RegExp(RULESET_PATTERN.slice(5), 'im');

// Preserve every retained byte, including CRLF and a missing final newline.
function stripAttribution(text) {
  return (text.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) || [])
    .filter((line) => !attribution.test(line))
    .join('');
}

async function cleanText({ get, update, fields, needsBody, core }) {
  // Read current text rather than overwriting a newer edit with event payload text.
  const { data: current } = await get();
  const patch = {};
  const removals = [];
  for (const field of fields) {
    const before = current[field] || '';
    const after = stripAttribution(before);
    if (after === before) continue;
    if (field === 'title' && !after.trim()) {
      core.setFailed('Attribution fills the title; replace it with a meaningful title.');
      continue;
    }
    patch[field] = needsBody && !after.trim() ? `${after}<!-- attribution removed -->` : after;
    removals.push({ field, lines: before.split(/\r\n|\r|\n/).filter((line) => attribution.test(line)).length });
  }
  if (Object.keys(patch).length) {
    await update(patch);
    for (const { field, lines } of removals) {
      core.notice(`Removed ${lines} attribution-matching line(s) from ${field}. Review the GitHub edit history to recover any unintended match.`);
    }
  }
  const { data: verified } = await get();
  if (fields.some((field) => attribution.test(verified[field] || ''))) {
    core.setFailed('AI attribution remains after cleanup; edit the affected text.');
  }
}

async function run({ github, context, core }) {
  const { payload, eventName, repo } = context;
  const options = { core, fields: ['body'], needsBody: true };
  const issues = github.rest.issues;
  const pulls = github.rest.pulls;
  if (eventName === 'pull_request_target') {
    const params = { ...repo, pull_number: payload.pull_request.number };
    options.get = () => pulls.get(params);
    options.update = (patch) => pulls.update({ ...params, ...patch });
    options.fields = ['title', 'body'];
    options.needsBody = false;
  } else if (eventName === 'issues') {
    const params = { ...repo, issue_number: payload.issue.number };
    options.get = () => issues.get(params);
    options.update = (patch) => issues.update({ ...params, ...patch });
    options.fields = ['title', 'body'];
    options.needsBody = false;
  } else if (eventName === 'issue_comment') {
    const params = { ...repo, comment_id: payload.comment.id };
    options.get = () => issues.getComment(params);
    options.update = (patch) => issues.updateComment({ ...params, ...patch });
  } else if (eventName === 'pull_request_review_comment') {
    const params = { ...repo, comment_id: payload.comment.id };
    options.get = () => pulls.getReviewComment(params);
    options.update = (patch) => pulls.updateReviewComment({ ...params, ...patch });
  } else if (eventName === 'pull_request_review') {
    const params = { ...repo, pull_number: payload.pull_request.number, review_id: payload.review.id };
    options.get = () => pulls.getReview(params);
    options.update = (patch) => pulls.updateReview({ ...params, ...patch });
  } else {
    throw new Error('Unsupported attribution cleanup event.');
  }
  try {
    await cleanText(options);
  } catch (error) {
    // Never echo submitted text, response bodies or credentials into logs.
    core.setFailed(`Attribution cleanup could not complete (HTTP ${Number(error.status) || 'unknown'}).`);
  }
}

module.exports = { RULESET_PATTERN, stripAttribution, cleanText, run };
