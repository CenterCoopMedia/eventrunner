'use strict';

/**
 * `runScheduledReminders`: the scheduled function behind the reminder
 * schedules (issue #518, ADR 0006). It runs every 60 minutes. Each branch
 * reads its own schedule, works out what is due from the settings and the
 * clock, sends it through the send path staff use, and records what it did.
 *
 * Each branch holds its own lease (`reminder_schedule_runs/{schedule}`), so
 * two runs never overlap, and a fault in one branch does not stop another.
 * A branch that is off, paused, on a historical demo, or past the end of
 * the event returns at once and writes nothing.
 *
 * The speaker branch (speakerSchedule.cjs) sends through the staff
 * speaker reminder path. The attendee branch (attendeeSchedule.cjs) sends
 * through the announcement send path (announcements/sendRunner.cjs).
 */

const { runSpeakerSchedule } = require('./speakerSchedule.cjs');
const { runAttendeeSchedule } = require('./attendeeSchedule.cjs');

/** Each schedule the runner serves, in run order. */
const BRANCHES = Object.freeze([
  { id: 'speakers', run: runSpeakerSchedule },
  { id: 'attendees', run: runAttendeeSchedule },
]);

/**
 * One run of every branch.
 *
 * @param {{ db, getConfig, sendEmail, provider?, emailCore?, notifyOperator?, now?, log? }} deps
 *   `sendEmail` serves the speaker branch; `provider` and `emailCore` the
 *   attendee branch.
 * @returns {Promise<Record<string, { outcome: string, reason?: string }>>}
 */
async function runScheduledReminders(deps, branches = BRANCHES) {
  const log = deps.log ?? console;
  const results = {};
  for (const branch of branches) {
    try {
      results[branch.id] = await branch.run(deps);
    } catch (err) {
      log.error(`scheduled reminders: the ${branch.id} branch failed`, err);
      results[branch.id] = { outcome: 'failed', reason: 'internal' };
    }
  }
  return results;
}

/** The secrets a run needs: the mail provider's, and the operator notifier's. */
function scheduledReminderSecretNames(env = process.env) {
  const { SEND_SECRETS_BY_PROVIDER } = require('../email/send.cjs').internals;
  const names = new Set(SEND_SECRETS_BY_PROVIDER[(env.EVENT_EMAIL_PROVIDER || '').trim()] || []);
  if ((env.EVENT_OPERATOR_NOTIFIER || '').trim() === 'webhook') {
    names.add('OPERATOR_WEBHOOK_URL');
    names.add('OPERATOR_WEBHOOK_SECRET');
  }
  return [...names];
}

function buildHandlers() {
  const { onSchedule } = require('firebase-functions/v2/scheduler');
  const { defineSecret } = require('firebase-functions/params');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const secrets = scheduledReminderSecretNames(process.env).map(defineSecret);

  return {
    // No retryCount: a failed run is not retried. The next hourly run works
    // out the same answer from the settings and the clock (ADR 0006).
    // 540 seconds: speaker reminders go one at a time, and attendee
    // reminders go in chunks of 200, one provider batch each.
    runScheduledReminders: onSchedule({ region, schedule: 'every 60 minutes', secrets, timeoutSeconds: 540 }, async () => {
      const { getDb } = require('../core/firestore.cjs');
      const { getEventConfig } = require('../core/config.cjs');
      const { createOperatorNotifier } = require('../notify/operator.cjs');
      const { getEmailProvider } = require('../email/providers/index.cjs');
      const { createEmailCore } = require('../email/send.cjs');
      const db = getDb();
      const getConfig = () => getEventConfig({ db });
      const provider = getEmailProvider({ env: process.env });
      const emailCore = createEmailCore({ db, provider, getConfig });
      const sendEmail = (message) => emailCore.send(message);
      const notifier = createOperatorNotifier({ env: process.env, getConfig, sendEmail });
      await runScheduledReminders({ db, getConfig, sendEmail, provider, emailCore, notifyOperator: notifier.notify });
    }),
  };
}

module.exports = {
  runScheduledReminders,
  scheduledReminderSecretNames,
  get handlers() {
    return buildHandlers();
  },
  internals: { BRANCHES },
};
