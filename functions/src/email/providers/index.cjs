'use strict';

/**
 * EmailProvider registry (spec §3.1). Dispatch on EVENT_EMAIL_PROVIDER;
 * when unset, default to console ONLY under the emulator — a production
 * deployment with no provider selected must fail loudly, not log mail to
 * nowhere.
 */

const { createConsoleProvider } = require('./console.cjs');
const { createWebhookProvider } = require('./webhook.cjs');
const { createPostmarkProvider } = require('./postmark.cjs');

/**
 * @param {{ env?: Record<string, string|undefined>,
 *           fetchImpl?: typeof fetch }} [deps]
 * @returns {{ name: 'postmark'|'webhook'|'console' }} EmailProvider
 */
function getEmailProvider({ env = process.env, fetchImpl } = {}) {
  // validateDeployEnv and getTierA both accept a padded value; dispatching
  // on the raw string would throw at runtime for env the build blessed.
  const selected = typeof env.EVENT_EMAIL_PROVIDER === 'string'
    ? env.EVENT_EMAIL_PROVIDER.trim()
    : env.EVENT_EMAIL_PROVIDER;
  switch (selected) {
    case 'postmark':
      return createPostmarkProvider({ env, fetchImpl });
    case 'webhook':
      return createWebhookProvider({ env, fetchImpl });
    case 'console':
      return createConsoleProvider({ env });
    case undefined:
    case null:
    case '':
      if (env.FUNCTIONS_EMULATOR === 'true') return createConsoleProvider({ env });
      throw new Error(
        'EVENT_EMAIL_PROVIDER is not set. Set it to one of: postmark, webhook, console ' +
        '(console defaults only under FUNCTIONS_EMULATOR=true).'
      );
    default:
      throw new Error(
        `Unknown EVENT_EMAIL_PROVIDER "${selected}". Expected one of: postmark, webhook, console.`
      );
  }
}

module.exports = { getEmailProvider };
