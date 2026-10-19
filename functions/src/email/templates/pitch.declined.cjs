'use strict';

/**
 * pitch.declined: see ./pitchNotice.cjs. The shipped subject and wording live in
 * packages/shared/src/pitch.cjs so the admin editor can show them.
 */

module.exports = require('./pitchNotice.cjs').pitchNoticeTemplate('pitch.declined');
