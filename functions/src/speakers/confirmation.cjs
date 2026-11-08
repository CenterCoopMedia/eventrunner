'use strict';

/**
 * speaker.confirmation sender — the per-SESSION confirmation naming what an
 * organizer has locked in for a speaker (spec §6.2/§6.3, phase 3, issue #22).
 *
 * Staff send it from the speaker editor with `sendSessionConfirmation`
 * (./sessionConfirmations.cjs), after a preview (owner decision,
 * 2026-11-08). That module owns the delivery record and the retry rule;
 * this one renders the email and sends one attempt.
 *
 * The send-once key is per attempt:
 * `speaker-confirmation:{speakerId}:{sessionId}:{attempt}`. It is per
 * session, not per speaker, so a speaker with three sessions gets three
 * independent confirmations. The attempt number lets a new confirmation go
 * when the session's title, time or room changed since the last one.
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
 * The slot one confirmation names: what the speaker reads, and what decides
 * whether a second confirmation may go. Built from the same token values the
 * email renders, so the record and the email cannot disagree.
 *
 * @returns {{ title: string, time: string, room: string }}
 */
function namedSlotOf(eventConfig, session) {
  const values = buildConfirmationTokenValues({ eventConfig, speaker: null, session });
  return { title: values.session_title, time: values.session_time, room: values.session_room };
}

/** True when two named slots are the same title, time and room. */
function sameNamedSlot(a, b) {
  if (!a || !b) return false;
  return ['title', 'time', 'room'].every((key) => String(a[key] ?? '') === String(b[key] ?? ''));
}

/**
 * Render speaker.confirmation for one named slot, with the operator's
 * override when one is stored. Used by the preview and by the send, so
 * staff read exactly what goes.
 *
 * @param {{ db: object, config: object, speaker: object,
 *           named: { title: string, time: string, room: string } }} args
 */
async function renderConfirmation({ db, config, speaker, named }) {
  const { render } = require('../email/render.cjs');
  const { getDefaultTemplate, loadTemplate } = require('../email/templates.cjs');
  const template = getDefaultTemplate('speaker.confirmation');
  const { override } = await loadTemplate({ db, id: 'speaker.confirmation' });
  const rendered = render({
    template,
    override,
    tokenValues: {
      speaker_name: speakerDisplayName(speaker),
      session_title: named.title,
      session_time: named.time,
      session_room: named.room,
      admin_contact_email: typeof config?.event?.legal?.supportEmail === 'string'
        ? config.event.legal.supportEmail
        : '',
    },
    config,
  });
  // A subject is one line, whatever the session title holds.
  return { ...rendered, subject: rendered.subject.replace(/\s+/g, ' ').trim() };
}

/**
 * Send one confirmation attempt through the central sender and return its
 * outcome. The caller (./sessionConfirmations.cjs) owns the delivery record
 * and passes the attempt's own send-once key,
 * `speaker-confirmation:{speakerId}:{sessionId}:{attempt}`, so a retried
 * request cannot send the same attempt twice and a changed slot can send a
 * new one.
 *
 * Never throws. The central sender throws only before it contacts the
 * provider, so a throw here is a definite `failed`. An `ambiguous` outcome
 * (the provider threw) is passed through for the caller to record as
 * `uncertain`.
 *
 * @param {{ db: object, sendEmail: Function, getConfig: () => Promise<object>,
 *           onceKey: string, speaker: object,
 *           named: { title: string, time: string, room: string },
 *           log?: Console }} args
 * @returns {Promise<{ status: string, error?: string, ambiguous?: boolean }>}
 */
async function sendSessionConfirmationEmail({ db, sendEmail, getConfig, onceKey, speaker, named, log = console }) {
  try {
    if (typeof sendEmail !== 'function' || typeof getConfig !== 'function') {
      throw new Error('Email sending is not configured.');
    }
    if (typeof onceKey !== 'string' || !onceKey) throw new Error('A send-once key is required.');
    const config = await getConfig();
    const rendered = await renderConfirmation({ db, config, speaker, named });
    if (rendered.usedFallback) {
      log.warn('speaker.confirmation: stored wording failed its token checks; sent the shipped wording', rendered.overrideErrors);
    }
    const outcome = await sendEmail({
      to: speaker.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tag: 'speaker.confirmation',
      source: 'speaker-confirmation',
      onceKey,
      storeRendered: rendered.storeRendered,
      hasLegalFooterHtml: rendered.hasLegalFooterHtml,
      hasLegalFooterText: rendered.hasLegalFooterText,
    });
    return outcome && typeof outcome === 'object' ? outcome : { status: 'failed', error: 'The email service gave no answer.' };
  } catch (err) {
    log.error('speaker.confirmation email failed', err);
    return { status: 'failed', error: String(err?.message || err) };
  }
}

module.exports = {
  formatSessionTime,
  buildConfirmationTokenValues,
  namedSlotOf,
  sameNamedSlot,
  renderConfirmation,
  sendSessionConfirmationEmail,
};
