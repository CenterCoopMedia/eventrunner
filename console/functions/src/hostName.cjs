'use strict';

/** Who a client reaches: the person the deployment names (CONSOLE_HELP_NAME), or the team. */
const hostName = (env = process.env) => env.CONSOLE_HELP_NAME?.trim() || 'the hosting team';

module.exports = { hostName };
