'use strict';

/**
 * speaker.confirmation sender — the per-SESSION confirmation naming what an
 * organizer has locked in for a speaker (spec §6.2/§6.3, phase 3, issue #22).
 *
 * Exported as a plain function rather than wired to an onRequest endpoint:
 * §6.3 assigns this template to the speaker port's definition of done —
 * tokenized, seeded as a code default, phase-3 — but nothing in the spec or
 * the issue names the admin ACTION that should trigger it (unlike
 * speaker.invite/accepted, which are pinned to the invite/acceptance
 * transaction by name). `sendSessionConfirmationEmail` is the seam a future
 * "confirm this session" admin action calls; shipping it now, ahead of that
 * caller, is the same ordering storage.rules' speaker-photos block used —
 * the namespace (here, the template + sender) exists and is tested before
 * its trigger does.
 *
 * onceKey is `speaker-confirmation:{speakerId}:{sessionId}` — per session,
 * not per speaker: a speaker with three sessions gets three independent
 * confirmations, and re-running a confirmation for session A must not be
 * blocked by session B's earlier send (nor vice versa).
 */

const { getDay } = require('shared/time');
const { speakerDisplayName } = require('shared/speaker');

/**
 * `{{session_time}}` as plain copy: the day's date plus the session's
 * clock-time range, exactly as authored in cmsSchedule — this is NOT
 * timezone-converted display formatting (that lives client-side in
 * apps/web/src/lib/eventTime.js), just the two stored strings joined
 * legibly for a transactional email.
 *
 * @param {{ days?: Array<object> }} eventConfig
 * @param {{ dayId?: string, startTime?: string, endTime?: string }} session
 * @returns {string}
 */
function formatSessionTime(eventConfig, session) {
  const day = getDay(eventConfig, session?.dayId);
  const date = day && typeof day.date === 'string' ? day.date : '';
  const start = typeof session?.startTime === 'string' ? session.startTime : '';
  const end = typeof session?.endTime === 'string' ? session.endTime : '';
  const clock = start && end ? `${start}–${end}` : start;
  return [date, clock].filter(Boolean).join(' · ');
}

/**
 * Token values for speaker.confirmation, pure and independently testable.
 *
 * @param {{ eventConfig: object, speaker: object,
 *           session: { title?: string, location?: string } }} args
 * @returns {{ speaker_name: string, session_title: string,
 *             session_time: string, session_room: string }}
 */
function buildConfirmationTokenValues({ eventConfig, speaker, session }) {
  return {
    speaker_name: speakerDisplayName(speaker),
    session_title: typeof session?.title === 'string' ? session.title : '',
    session_time: formatSessionTime(eventConfig, session),
    session_room: typeof session?.location === 'string' ? session.location : '',
  };
}

/**
 * Send the confirmation. Best-effort by design, same reasoning as
 * sendAcceptedEmail (invites.cjs): whatever confirmed the session is already
 * durable by the time this runs, so a mail failure must not turn a completed
 * action into an error the caller has to retry.
 *
 * @param {{ db: object, sendEmail: Function, getConfig: () => Promise<object>,
 *           speakerId: string, sessionId: string, speaker: object,
 *           session: object, log?: Console }} args
 * @returns {Promise<{ ok: boolean }>}
 */
async function sendSessionConfirmationEmail({ db, sendEmail, getConfig, speakerId, sessionId, speaker, session, log = console }) {
  try {
    const { render } = require('../email/render.cjs');
    const { getDefaultTemplate, loadTemplate } = require('../email/templates.cjs');
    const config = await getConfig();
    const template = getDefaultTemplate('speaker.confirmation');
    const { override } = await loadTemplate({ db, id: 'speaker.confirmation' });
    const rendered = render({
      template,
      override,
      tokenValues: {
        ...buildConfirmationTokenValues({ eventConfig: config?.event, speaker, session }),
        admin_contact_email: typeof config?.event?.legal?.supportEmail === 'string'
          ? config.event.legal.supportEmail
          : '',
      },
      config,
    });
    await sendEmail({
      to: speaker.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tag: 'speaker.confirmation',
      source: 'speaker-confirmation',
      onceKey: `speaker-confirmation:${speakerId}:${sessionId}`,
      storeRendered: rendered.storeRendered,
      hasLegalFooterHtml: rendered.hasLegalFooterHtml,
      hasLegalFooterText: rendered.hasLegalFooterText,
    });
    return { ok: true };
  } catch (err) {
    log.error('speaker.confirmation email failed', err);
    return { ok: false };
  }
}

module.exports = {
  formatSessionTime,
  buildConfirmationTokenValues,
  sendSessionConfirmationEmail,
};
