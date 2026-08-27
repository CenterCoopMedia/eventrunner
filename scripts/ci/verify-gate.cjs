'use strict';

const JOBS = Object.freeze([
  { label: 'docs', selected: 'DOCS_SELECTED', result: 'DOCS_RESULT' },
  { label: 'demo', selected: 'DEMO_SELECTED', result: 'DEMO_RESULT' },
  { label: 'lint', selected: 'LINT_SELECTED', result: 'LINT_RESULT' },
  { label: 'audit', selected: 'AUDIT_SELECTED', result: 'AUDIT_RESULT' },
  { label: 'unit', selected: 'UNIT_SELECTED', result: 'UNIT_RESULT' },
  { label: 'unit-web', selected: 'UNIT_WEB_SELECTED', result: 'UNIT_WEB_RESULT' },
  { label: 'build', selected: 'BUILD_SELECTED', result: 'BUILD_RESULT' },
  { label: 'hygiene', selected: 'HYGIENE_SELECTED', result: 'HYGIENE_RESULT' },
  { label: 'rules', selected: 'RULES_SELECTED', result: 'RULES_RESULT' },
  { label: 'e2e', selected: 'E2E_SELECTED', result: 'E2E_RESULT' },
]);

function requireResult(env, name, expected) {
  if (env[name] !== expected) {
    throw new Error(`${name} must be ${expected}, got ${env[name] || 'missing'}`);
  }
}

function verifyGate(env = process.env) {
  requireResult(env, 'CHANGES_RESULT', 'success');
  requireResult(env, 'SECRETS_RESULT', 'success');
  if (env.EVENT_NAME === 'pull_request') {
    requireResult(env, 'DCO_RESULT', 'success');
  } else if (env.EVENT_NAME === 'push') {
    requireResult(env, 'DCO_RESULT', 'skipped');
  } else {
    throw new Error('EVENT_NAME must be pull_request or push');
  }

  for (const { label, selected, result } of JOBS) {
    if (env[selected] !== 'true' && env[selected] !== 'false') {
      throw new Error(`${selected} must be exactly true or false`);
    }
    const expected = env[selected] === 'true' ? 'success' : 'skipped';
    if (env[result] !== expected) {
      throw new Error(`${label} was ${env[selected] === 'true' ? 'selected' : 'not selected'} but finished with ${env[result] || 'missing'}`);
    }
  }
}

function main(env = process.env) {
  verifyGate(env);
  console.log('CI gate passed: every selected tier succeeded.');
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`CI gate failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { JOBS, main, verifyGate };
