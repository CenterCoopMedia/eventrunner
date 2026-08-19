'use strict';

// Export barrel ONLY — no logic, no handler bodies (spec §1.3).
// Each domain module under src/ exports { handlers }, and every deployable
// export is re-exported here by name.

const email = require('./src/email/send.cjs');

module.exports = {
  ...email.handlers,
};
