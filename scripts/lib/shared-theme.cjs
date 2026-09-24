'use strict';

/**
 * `shared/theme`, reachable with no `npm install`.
 *
 * The bare specifier resolves through the workspace link npm writes into
 * `node_modules`. The documentation CI tier deliberately has none: it runs
 * `scripts/check-docs.cjs` and `scripts/build-pages.test.cjs` on the
 * runner's own Node, without `npm ci` (`.github/workflows/ci.yml`, job
 * `docs`). `scripts/build-pages.cjs` reaches the token generator from that
 * tier, so the path from `scripts/` into `packages/` is named here once
 * instead of at every call site.
 *
 * It is the same file the bare specifier resolves to — `packages/shared`'s
 * `exports` map points `./theme` at exactly this path.
 */

// The preset remaps register themselves with the resolver when they are
// required (2026-09-10 vocabulary expansion), and the token generator
// resolves every style in full, so they are required here once for every
// script that reaches the resolver through this file.
require('../../packages/shared/src/presetRemaps.cjs');

module.exports = require('../../packages/shared/src/theme.cjs');
