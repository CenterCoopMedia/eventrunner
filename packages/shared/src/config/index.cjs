'use strict';

/**
 * Barrel for the config layer: lifecycle clock (§2.5), Tier B document
 * validation (§2.2), and Tier A deploy env validation (§2.1).
 */

module.exports = {
  ...require('./lifecycle.cjs'),
  ...require('./schema.cjs'),
  ...require('./deploy.cjs'),
};
