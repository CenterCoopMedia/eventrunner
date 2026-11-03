'use strict';

// The answers builder lives in shared/answers so the CLI, the browser and a
// callable run one validator (ADR 0007). The seed path keeps calling
// `buildConfigDocs({ answers, tierA })`; this wrapper supplies the seeded
// default theme, which is a seed concern owned by ./theme.cjs.
const shared = require('shared/answers');
const { defaultTheme } = require('./theme.cjs');

/**
 * @param {{ answers: object, tierA: object, now?: () => number }} args
 * @returns {ReturnType<typeof shared.buildConfigDocs>}
 */
function buildConfigDocs(args) {
  return shared.buildConfigDocs({ ...args, baseTheme: defaultTheme() });
}

module.exports = { ...shared, buildConfigDocs };
