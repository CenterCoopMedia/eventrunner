// Card payment through a Stripe pay link (issue #519), in the invoice record.
//
// PayByCard: on an issued invoice, staff make a Stripe link for the invoice
// total. The server builds it from the frozen invoice; this page sends only
// the invoice id. While the link works, the page shows it and when it ends.
// Without Stripe, the server's reason is shown and nothing is offered.
// Earlier links are listed with how each one ended.
//
// PaymentReviews: a card payment Stripe took that was not applied (after a
// void, for another amount, and so on) is shown on the alarm ground until an
// operator closes it with a note. Staff are told an operator reviews it.
//
// These sit inside the editor's <form>, so their controls are plain buttons.
import { useEffect, useId, useRef, useState } from 'react';
import {
  INVOICE_LIMITS,
  PAY_LINK_STATUS_WORDS,
  formatMoney,
  formatPayLinkEnd,
  validateReviewNote,
} from 'shared/invoice';
import {
  ServerErrorSummary,
  TextField,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import { focusFirstError } from '../../lib/focusFirstError.js';

const NO_STRIPE = 'Card payment links need Stripe. This site does not take card payments through Stripe.';

/** Why a link closed, in words. */
const CLOSED_WORDS = Object.freeze({
  void: 'The invoice was voided.',
  paid: 'A payment was recorded.',
  ended: 'It ran out.',
  refused: 'Stripe refused it.',
  mismatch: 'Stripe answered with a page that did not match the invoice.',
  'no-answer': 'Stripe did not answer in time.',
  replaced: 'A new link replaced it near its end.',
  issued: 'The invoice changed while it was made.',
});

/** How a flagged payment differs from what the invoice expected. */
function reviewPhrase(entry) {
  switch (entry.code) {
    case 'invoice-void': return 'after it was voided';
    case 'invoice-already-paid': return 'after it was already paid';
    case 'invoice-not-issued': return 'before it was issued';
    case 'link-cancelled': return 'through a link that had been closed';
    case 'currency-mismatch': return `in a different currency (${(entry.currency ?? '').toUpperCase() || 'unknown'})`;
    case 'amount-mismatch': return 'for an amount that is not the invoice total';
    default: return 'through a payment page this invoice has no record of';
  }
}

/** "2026-10-20 14:05" on the reader's clock. */
function localTime(iso) {
  const ms = Date.parse(iso ?? '');
  if (!Number.isFinite(ms)) return 'an unknown time';
  const date = new Date(ms);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The link a payer can use now, or null. */
export function openPayLink(invoice, nowMs = Date.now()) {
  if (invoice?.status !== 'issued') return null;
  const last = (invoice.payLinks ?? []).at(-1);
  if (!last || last.status !== 'open' || typeof last.url !== 'string') return null;
  let url;
  try {
    url = new URL(last.url);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const ends = Date.parse(last.expiresAt ?? '');
  return Number.isFinite(ends) && ends > nowMs ? last : null;
}

function linkHistoryText(link, timeZone) {
  const words = PAY_LINK_STATUS_WORDS[link.status] ?? 'Not made';
  let text = `${words}: made ${localTime(link.createdAt)}.`;
  if (link.closedReason && CLOSED_WORDS[link.closedReason]) text += ` ${CLOSED_WORDS[link.closedReason]}`;
  if (link.status === 'cancelled' && link.stripeClosed === true) text += ' Stripe closed it.';
  if (link.status === 'cancelled' && link.stripeClosed !== true) {
    const end = formatPayLinkEnd(link.expiresAt, timeZone);
    const outcome = link.closedReason === 'replaced'
      ? 'A payment through it still counts while the invoice is unpaid.'
      : 'A payment through it is flagged for review, not applied.';
    text += ` Stripe was not told, so the link may work${end ? ` until ${end}` : ' until it ends'}. ${outcome}`;
  }
  return text;
}

/**
 * @param {{ invoice: object, cardPayments?: { available: boolean, reason: string|null, testMode: boolean },
 *           timeZone?: string, busy: string|null, onCreatePayLink: () => Promise<void> }} props
 */
export function PayByCard({ invoice, cardPayments, timeZone, busy, onCreatePayLink }) {
  const headingId = useId();
  const linkRef = useRef(null);
  const [error, setError] = useState(null);
  const [focusLink, setFocusLink] = useState(false);
  const links = invoice.payLinks ?? [];
  const current = openPayLink(invoice);
  const earlier = links.filter((link) => link !== current);
  const issued = invoice.status === 'issued';
  const available = cardPayments?.available === true;

  // The button that made the link is gone, so the keyboard moves to the link.
  useEffect(() => {
    if (focusLink && linkRef.current) {
      linkRef.current.focus();
      setFocusLink(false);
    }
  }, [focusLink, current]);

  if (!issued && links.length === 0) return null;

  async function create() {
    if (busy) return;
    setError(null);
    try {
      await onCreatePayLink();
      setFocusLink(true);
    } catch (err) {
      setError(err);
    }
  }

  const total = formatMoney(invoice.totals?.total ?? 0, invoice.currency);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-xs border-admin-rule-hairline border-t-admin-hairline pt-sm">
      <h3 id={headingId} className="text-admin-base font-bold text-admin-ink">Pay by card</h3>
      {issued && !available ? (
        <p className="max-w-[65ch] text-admin-sm text-admin-ink-secondary">{cardPayments?.reason || NO_STRIPE}</p>
      ) : null}
      {available && cardPayments.testMode && issued ? (
        <p className="max-w-[65ch] text-admin-sm text-admin-ink-secondary">Stripe test mode. No real money moves through these links.</p>
      ) : null}
      {current ? (
        <div className="flex flex-col gap-3xs">
          <p className="max-w-[65ch] text-admin-sm text-admin-ink">
            {`The billing contact can pay ${total} by card at this link. It is printed on the PDF and included when you email the invoice. When Stripe confirms the payment, the invoice is marked paid.`}
          </p>
          <p>
            <a
              ref={linkRef}
              href={current.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-admin-ink underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Open the card payment link<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </p>
          <p className="max-w-[65ch] break-all font-admin-data text-admin-sm text-admin-ink-secondary">{current.url}</p>
          <p className="text-admin-sm text-admin-ink">{`Works until ${formatPayLinkEnd(current.expiresAt, timeZone)}.`}</p>
        </div>
      ) : null}
      {!current && issued && available ? (
        <div className="flex flex-col gap-xs">
          <p className="max-w-[65ch] text-admin-sm text-admin-ink">
            {`Make a Stripe link the billing contact can use to pay ${total} by card. It works for 23 hours. When Stripe confirms the payment, the invoice is marked paid.`}
          </p>
          <ServerErrorSummary error={error} title="The link was not made" />
          <div>
            <button
              type="button"
              className={primaryButtonClass}
              disabled={busy !== null}
              aria-busy={busy === 'paylink' || undefined}
              onClick={create}
            >
              {busy === 'paylink' ? 'Making the link…' : 'Make a card payment link'}
            </button>
          </div>
        </div>
      ) : null}
      {earlier.length ? (
        <EarlierLinks links={earlier} timeZone={timeZone} />
      ) : null}
    </section>
  );
}

function EarlierLinks({ links, timeZone }) {
  const headingId = useId();
  return (
    <div className="flex flex-col gap-3xs">
      <h4 id={headingId} className="text-admin-sm font-bold text-admin-ink">Earlier card payment links</h4>
      <ul aria-labelledby={headingId} className="flex list-disc flex-col gap-3xs ps-5 text-admin-sm text-admin-ink">
        {[...links].reverse().map((link, index) => (
          <li key={link.linkId ?? index}>{linkHistoryText(link, timeZone)}</li>
        ))}
      </ul>
    </div>
  );
}

/** An operator's note that closes one flagged payment. */
function ReviewForm({ busy, onSubmit, onCancel }) {
  const sectionRef = useRef(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [serverError, setServerError] = useState(null);
  const [focusRequest, setFocusRequest] = useState(0);

  useEffect(() => {
    if (focusRequest > 0) focusFirstError(sectionRef.current);
  }, [focusRequest]);
  useEffect(() => {
    sectionRef.current?.querySelector('input')?.focus();
  }, []);

  async function submit() {
    if (busy) return;
    const verdict = validateReviewNote(note);
    if (!verdict.ok) {
      setError(verdict.issues[0].message);
      setFocusRequest((count) => count + 1);
      return;
    }
    setError('');
    setServerError(null);
    try {
      await onSubmit(verdict.value);
    } catch (err) {
      setServerError(err);
    }
  }

  return (
    <div ref={sectionRef} className="flex flex-col gap-xs">
      <ServerErrorSummary error={serverError} title="The review was not saved" />
      <TextField
        label="Review note"
        hint="Required. What was done, such as a refund in the Stripe Dashboard. Kept with the payment and in the audit log."
        value={note}
        onChange={setNote}
        error={error}
        maxLength={INVOICE_LIMITS.reviewNote}
        className="sm:max-w-[28rem]"
      />
      <div className="flex flex-wrap items-center gap-xs">
        <button type="button" className={primaryButtonClass} disabled={busy} aria-busy={busy || undefined} onClick={submit}>
          {busy ? 'Saving…' : 'Save review'}
        </button>
        <button type="button" className={secondaryButtonClass} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * @param {{ invoice: object, canResolve: boolean, busy: string|null,
 *           onResolve: (reviewId: string, note: string) => Promise<void> }} props
 */
export function PaymentReviews({ invoice, canResolve, busy, onResolve }) {
  const headingId = useId();
  const doneId = useId();
  const [open, setOpen] = useState(null);
  const reviews = invoice.paymentReviews ?? [];
  const waiting = reviews.filter((entry) => !entry.resolved);
  const done = reviews.filter((entry) => entry.resolved);
  if (!reviews.length) return null;
  const money = (entry) => (entry.amount === null || entry.amount === undefined
    ? 'a payment'
    : formatMoney(entry.amount, entry.currency || invoice.currency));
  return (
    <>
      {waiting.length ? (
        <section
          aria-labelledby={headingId}
          className="flex flex-col gap-xs rounded-admin-panel border-admin-alarm border-admin-rule-alarm bg-admin-ground-alarm px-md py-sm"
        >
          <h3 id={headingId} className="text-admin-base font-bold text-admin-state-error">
            {waiting.length === 1 ? 'A card payment needs review' : `${waiting.length} card payments need review`}
          </h3>
          {waiting.map((entry) => (
            <div key={entry.reviewId} className="flex flex-col gap-3xs text-admin-sm text-admin-ink">
              <p className="max-w-[65ch] font-bold">{`Stripe took ${money(entry)} for this invoice ${reviewPhrase(entry)}.`}</p>
              <p className="max-w-[65ch]">
                It was recorded here and not applied to the invoice. Check it in the Stripe Dashboard, then refund it or record it another way.
              </p>
              {entry.paymentIntentId ? (
                <p className="font-admin-data">{`Stripe payment ${entry.paymentIntentId}, received ${localTime(entry.at)}.`}</p>
              ) : null}
              {canResolve ? (
                open === entry.reviewId ? (
                  <ReviewForm
                    busy={busy === 'review'}
                    onCancel={() => setOpen(null)}
                    onSubmit={async (note) => {
                      await onResolve(entry.reviewId, note);
                      setOpen(null);
                    }}
                  />
                ) : (
                  <div>
                    <button type="button" className={secondaryButtonClass} disabled={busy !== null} onClick={() => setOpen(entry.reviewId)}>
                      Mark reviewed
                    </button>
                  </div>
                )
              ) : (
                <p>An operator reviews it.</p>
              )}
            </div>
          ))}
        </section>
      ) : null}
      {done.length ? (
        <div className="flex flex-col gap-3xs">
          <h3 id={doneId} className="text-admin-base font-bold text-admin-ink">Reviewed card payments</h3>
          <ul aria-labelledby={doneId} className="flex list-disc flex-col gap-3xs ps-5 text-admin-sm text-admin-ink">
            {done.map((entry) => (
              <li key={entry.reviewId}>{`${money(entry)}, ${reviewPhrase(entry)}. Reviewed: ${entry.note || 'no note'}`}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
