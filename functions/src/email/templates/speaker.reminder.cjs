'use strict';

/**
 * speaker.reminder — what staff send an accepted speaker who still owes the
 * event something (functions/src/speakers/reminders.cjs).
 *
 * The items are FLAGS and plain lists, not prose: the wording of each line
 * lives here, in the template, so staff can rewrite every sentence through
 * an `email_templates/speaker.reminder` override (the admin's reminder
 * wording editor) while the token set stays fixed.
 *
 *   {{needs_bio}}, {{needs_headshot}}  "yes" when the item is missing,
 *                                      empty otherwise; each guards its line
 *   {{description_sessions}}           the titles of the speaker's sessions
 *                                      with no description, joined by "; "
 *   {{materials_sessions}}             the titles with no pending or
 *                                      approved material, joined the same way
 *   {{due_date}}, {{days_left}}        set only by the reminder schedule
 *                                      (functions/src/reminders/), empty for
 *                                      a staff send: the due date in words on
 *                                      the event's clock, and the whole
 *                                      calendar days left until it. Each
 *                                      belongs inside an {{#if}}. The shipped
 *                                      copy uses only the date, so it never
 *                                      reads "1 days" or "0 days"; staff
 *                                      wording may use either.
 *
 * Session titles are staff-authored but still plain tokens, so the renderer
 * HTML-escapes them in the html body. No value here may populate an `_html`
 * token (render.cjs invariant).
 *
 * requiredTokens: ['dashboard_url'] — the reminder's job is to get the
 * speaker to the page where they act. An override that drops the link
 * leaves them with a list and nowhere to go.
 *
 * storeRendered: true — no bearer credential, so the ordinary sent_emails
 * audit applies and the email log can show what each speaker got.
 */

const { GLOBAL_TOKEN_NAMES } = require('../render.cjs');
const { buildSpeakerWording } = require('../speakerWordingFields.cjs');

const source = buildSpeakerWording('speaker.reminder');

module.exports = {
  id: 'speaker.reminder',
  ...source,
  tokens: [
    ...GLOBAL_TOKEN_NAMES,
    'speaker_name',
    'dashboard_url',
    'profile_url',
    'admin_contact_email',
    'needs_bio',
    'needs_headshot',
    'description_sessions',
    'materials_sessions',
    'due_date',
    'days_left',
  ],
  requiredTokens: ['dashboard_url'],
  storeRendered: true,
};
