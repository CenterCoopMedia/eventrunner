'use strict';

// Exact pattern from repository ruleset 26508211 (2026-11-03).
const RULESET_PATTERN = "(?im)(^co-authored-by:.*(claude|anthropic|openai|codex|chatgpt|gemini|copilot|cursor|grok|kimi)|^claude-session:|generated (with|by) .*(claude|openai|codex|chatgpt|gemini|copilot|cursor|grok|kimi)|noreply@anthropic\\.com|noreply@openai\\.com)";
const attribution = new RegExp(RULESET_PATTERN.slice(5), 'im');

// #902: named review credits reached squash commits through PR bodies (#896).
// The push ruleset catches trailers/footers, but does not cover these lines.
// This check remains needed while the repository prohibits named review credits.
const MODEL = String.raw`(?:claude|opus|sonnet|haiku|codex|gpt(?:[- ]?\d[\w.-]*)?|chatgpt|openai|anthropic|gemini|copilot|cursor|grok|kimi|qwen|deepseek|llama|windsurf|aider)`;
const LINE_START = String.raw`^[ \t]*(?:(?:[-*+>]|\d+[.)]|#{1,6})[ \t]+)?[*_\[]*`;
const namedModel = new RegExp(String.raw`^[ \t*_:\[(]*(?:(?:passed|completed|performed|provided|verified|by|with|using|via|the)[ \t:()_*\[]+)*${MODEL}\b`, 'i');
const EFFORT = String.raw`(?:low|medium|high|xhigh)(?:[ \t]+effort)?`;
const parenthesizedModel = new RegExp(String.raw`^[ \t]*\([ \t]*${MODEL}\b(?:[ \t]+(?:${MODEL}|v?\d[\w.-]*|code)){0,6}(?:(?:[ \t]*,[ \t]*|[ \t]+)(?:${EFFORT}|\([ \t]*${EFFORT}[ \t]*\)))?[ \t]*\)[ \t]*$`, 'i');
const reviewLabel = new RegExp(String.raw`${LINE_START}(?:(?:independent|full[- ]diff|cross[- ](?:model|family)|local|code|security|final|peer|automated)[ \t]+)*(?:(?:review(?:er|ed)?|credits?|attribution)\b([^\r\n]*?)(?::|=|[ \t]+-[ \t]+|\bby\b|\bwith\b|\busing\b)|(?:written|authored|generated|checked|approved)[ \t]+(?:by|with|using)\b|co[- ]authored[- ]by[ \t]*:)([^\r\n]*)`, 'i');
const reviewerFirst = new RegExp(String.raw`${LINE_START}\b${MODEL}\b(?:[ \t]+(?:${MODEL}|v?\d[\w.-]*|\((?:low|medium|high|xhigh)\)|code|cross[- ](?:model|family)|full[- ]diff|security|independent|local)){0,6}[*_\]]*[ \t]+(?:review(?:ed|er)?|authored|generated|wrote|checked|approved)\b`, 'i');

function hasReviewCredit(text) {
  return text.split(/\r\n|\r|\n/).some((line) => {
    const label = reviewLabel.exec(line);
    if (label) {
      if (namedModel.test(label[2]) || parenthesizedModel.test(label[1] || '')) return true;
      const result = /^[ \t]*(?:clean|pass(?:ed)?|approved|no (?:findings|comments))[ \t]+(.+)$/i.exec(label[2]);
      if (result && parenthesizedModel.test(result[1])) return true;
    }
    return reviewerFirst.test(line);
  });
}

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
  } else if (fields.some((field) => hasReviewCredit(verified[field] || ''))) {
    core.setFailed('A named model/tool review credit remains; remove the credit line from the affected GitHub text.');
  }
  return verified;
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
    const verified = await cleanText(options);
    if (eventName === 'pull_request_target' && verified.state === 'open') {
      // Compare immutable SHAs, not a mutable branch name or all repository
      // history. Explicit pagination also covers PRs with more than 250 commits.
      const commits = await github.paginate(github.rest.repos.compareCommitsWithBasehead, {
        ...repo, basehead: `${verified.base.sha}...${verified.head.sha}`, per_page: 100,
      }, ({ data }) => data.commits);
      if (commits.some(({ commit }) => attribution.test(commit.message) || hasReviewCredit(commit.message))) {
        core.setFailed('A PR commit message contains model/tool attribution; use git rebase -i to reword the unmerged commit.');
      }
    }
  } catch (error) {
    // Never echo submitted text, response bodies or credentials into logs.
    core.setFailed(`Attribution cleanup could not complete (HTTP ${Number(error.status) || 'unknown'}).`);
  }
}

module.exports = { RULESET_PATTERN, hasReviewCredit, stripAttribution, cleanText, run };
