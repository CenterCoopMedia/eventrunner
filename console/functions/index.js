'use strict';

// Export barrel only: the client console's functions (ADR 0007). They
// deploy to the console project with console/firebase.json, never to a
// client project.

const { buildHandlers } = require('./src/handlers.cjs');

module.exports = buildHandlers();
