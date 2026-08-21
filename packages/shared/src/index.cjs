'use strict';

/**
 * Root barrel for the shared workspace. Prefer the subpath exports
 * ("shared/time", "shared/config", ...) in new code; this barrel exists
 * for convenience and for consumers that want everything.
 */

module.exports = {
  ...require('./time.cjs'),
  ...require('./config/index.cjs'),
  ...require('./registration.cjs'),
  ...require('./badges.cjs'),
  ...require('./slug.cjs'),
  ...require('./urlSafety.cjs'),
  ...require('./routing.cjs'),
};
