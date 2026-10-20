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
 * How long one run may start new work: the 540-second function timeout,
 * less a minute for the step in flight, the last-run stamps and the admin
 * log rows.
 */
const RUN_BUDGET_MS = 480_000;

/**
 * One run of every branch. The branches run side by side, not one after
 * the other, and share one deadline: a long speaker run cannot use up the
 * time the attendee run needs, or the other way round. Each branch stops
 * starting new work (a speaker, a chunk of 200 addresses) at the deadline;
 * what is left has no ledger row or is still on its send record, so the
 * next hourly run sends it. The branches touch different documents and
 * hold different leases, so running them together is safe.
 *
 * @param {{ db, getConfig, sendEmail, provider?, emailCore?, notifyOperator?, now?, log?, deadlineMs? }} deps
 *   `sendEmail` serves the speaker branch; `provider` and `emailCore` the
 *   attendee branch.
 * @returns {Promise<Record<string, { outcome: string, reason?: string }>>}
 */
async function runScheduledReminders(deps, branches = BRANCHES) {
  const log = deps.log ?? console;
  const now = deps.now ?? Date.now;
  const deadlineMs = deps.deadlineMs ?? now() + RUN_BUDGET_MS;
  const entries = await Promise.all(branches.map(async (branch) => {
    try {
      return [branch.id, await branch.run({ ...deps, deadlineMs })];
    } catch (err) {
      log.error(`scheduled reminders: the ${branch.id} branch failed`, err);
      return [branch.id, { outcome: 'failed', reason: 'internal' }];
    }
  }));
  return Object.fromEntries(entries);
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
  internals: { BRANCHES, RUN_BUDGET_MS },
};
