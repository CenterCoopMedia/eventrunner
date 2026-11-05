// Registration answers on the Attendees page (ADR 0008 §4). The summary
// counts what catering and access planning need; each attendee's record
// lists that attendee's own answers. Both read ticket_answers, which only
// staff (and each ticket holder, for their own) can read.
//
// Access needs are counted in the summary, never quoted there: staff read
// them one by one on each attendee's record.
import { activeQuestions, answerText, summarizeAnswers } from 'shared/registrationForm';
import { Panel, fieldHintClass } from './formControls.jsx';
import { ticketStatusLabel } from '../../lib/ticketingCommerce.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** @param {{ form: object|null, records: object[] }} props */
export function RegistrationSummary({ form, records }) {
  const summary = summarizeAnswers(records, form);
  const hasCounts = summary.dietary || summary.accessNeeds || summary.photoConsent;
  return (
    <Panel
      title="Registration answers"
      description={`${plural(summary.total, 'attendee')} answered the registration questions. Diet and access answers are private to staff.`}
    >
      {!hasCounts ? <p className={fieldHintClass}>The form asks no diet, access or photo questions.</p> : (
        <dl className="grid gap-sm sm:grid-cols-3">
          {summary.dietary ? (
            <div>
              <dt className="font-semibold text-admin-ink">Dietary needs</dt>
              <dd className="text-admin-sm text-admin-ink-secondary">
                {summary.dietary.answered ? (
                  <ul aria-label="Dietary needs">
                    {Object.entries(summary.dietary.choices).map(([choice, count]) => <li key={choice}>{choice}: {count}</li>)}
                    {summary.dietary.other.length ? <li>Other: {summary.dietary.other.join('; ')}</li> : null}
                  </ul>
                ) : 'None given.'}
              </dd>
            </div>
          ) : null}
          {summary.accessNeeds ? (
            <div>
              <dt className="font-semibold text-admin-ink">Access needs</dt>
              <dd className="text-admin-sm text-admin-ink-secondary">
                {summary.accessNeeds.answered ? `${plural(summary.accessNeeds.answered, 'attendee')} told you about access needs. Read each one in that attendee's record.` : 'None given.'}
              </dd>
            </div>
          ) : null}
          {summary.photoConsent ? (
            <div>
              <dt className="font-semibold text-admin-ink">Photo consent</dt>
              <dd className="text-admin-sm text-admin-ink-secondary">Yes: {summary.photoConsent.yes}. No: {summary.photoConsent.no}.</dd>
            </div>
          ) : null}
        </dl>
      )}
    </Panel>
  );
}

/** @param {{ form: object|null, records: object[] }} props one attendee's answer records, one per ticket */
export function AttendeeAnswers({ form, records }) {
  const questions = activeQuestions(form);
  if (!questions.length) return null;
  return (
    <section aria-label="Registration answers" className="flex flex-col gap-xs">
      <h3 className="font-admin-ui text-admin-base font-semibold text-admin-ink">Registration answers</h3>
      {!records.length ? <p className={fieldHintClass}>No answers yet.</p> : records.map((record, index) => {
        const invalid = record.ticketStatus !== undefined && record.ticketStatus !== 'valid';
        return (
          <dl key={record.id} className="grid gap-x-sm gap-y-3xs sm:grid-cols-[12rem_minmax(0,1fr)]">
            {records.length > 1 || invalid ? (
              <p className="font-admin-data text-admin-xs text-admin-ink-data sm:col-span-2">
                Ticket {index + 1}{invalid ? ` (not counted: ${ticketStatusLabel(record.ticketStatus).toLowerCase()})` : ''}
              </p>
            ) : null}
            {questions.map((question) => {
              // The question as this attendee answered it, when the record has it.
              const answered = Array.isArray(record.questions) ? record.questions.find((entry) => entry.id === question.id) : null;
              return (
                <div key={question.id} className="contents">
                  <dt className="text-admin-sm font-semibold text-admin-ink">{answered?.name ?? question.name}{question.sensitive ? ' (private)' : ''}</dt>
                  <dd className="whitespace-pre-line text-admin-sm text-admin-ink-secondary [overflow-wrap:anywhere]">{answerText(question, record.answers?.[question.id], answered) || 'No answer'}</dd>
                </div>
              );
            })}
          </dl>
        );
      })}
    </section>
  );
}
