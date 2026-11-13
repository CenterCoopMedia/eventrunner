import { Fragment, useId, useMemo } from 'react';
import { zoneLabel } from '../../lib/eventTime.js';
import { buildPreviewDoc } from '../emailPreview.js';
import { communicationsError } from './communicationsErrors.js';
import HelpDisclosure from './HelpDisclosure.jsx';
import { Notice, linkButtonClass, secondaryButtonClass } from './formControls.jsx';
import { AdminLoadingState, StatusBadge } from './adminChrome.jsx';
import AdminTableScroll from './AdminTableScroll.jsx';

/** Every `source` a sender stamps on its row, in the words staff read. */
export const SOURCE_LABELS = Object.freeze({
  'auth-otp': 'Sign-in code',
  'speaker-invite': 'Speaker invitation',
  'speaker-accept': 'Speaker acceptance',
  'speaker-confirmation': 'Speaker confirmation',
  feedback: 'Feedback receipt',
  'operator-notify': 'Operator alert',
  'ticketing-registration-prompt': 'Ticket prompt',
  announcement: 'Announcement',
  'announcement-test': 'Announcement test',
  invoice: 'Invoice',
  'speaker-reminder': 'Speaker reminder',
  'speaker-profile': 'Speaker profile request',
  'admin-access': 'Admin access',
  'change-requests': 'Change request notice',
  'attendee-approval': 'Attendee approval',
  'session-pitches': 'Pitch notice',
  'ticketing-confirmation': 'Ticket confirmation',
  'account-welcome': 'Welcome email',
});

/**
 * A delivery event the provider reported, as a word and the tone that
 * agrees with it. The two words a reader may not know carry a short gloss,
 * the same one docs/ADMIN_GUIDE.md gives.
 */
const DELIVERY_WORDS = Object.freeze({
  delivered: { label: 'Delivered', tone: 'ok' },
  bounced: { label: 'Bounced', tone: 'error' },
  complained: { label: 'Marked as spam', tone: 'caution', gloss: 'The recipient marked it as spam.' },
  suppressed: {
    label: 'Not sent',
    tone: 'caution',
    gloss: 'The mail provider did not send it, because the address is on its block list.',
  },
});

/**
 * Whether `key` names an entry of one of the maps above. An own-key check,
 * because a URL or a stored field can say "constructor" or "__proto__", and
 * a plain lookup would find the object's prototype instead of nothing.
 */
export const known = (map, key) => typeof key === 'string' && Object.hasOwn(map, key);

/**
 * Intl in the event's zone, or in the reader's own when the event states
 * none or states one Intl does not know. Returns the zone it used.
 */
function formatIn(timeZone, instant, options) {
  try {
    return { text: new Intl.DateTimeFormat('en-US', { timeZone, ...options }).format(instant), zone: timeZone };
  } catch {
    return { text: new Intl.DateTimeFormat('en-US', options).format(instant), zone: undefined };
  }
}

function withZone({ text, zone }, instant) {
  const label = zoneLabel(zone, instant);
  return label ? `${text} ${label}` : text;
}

/** "Nov 14, 2023, 10:13 PM UTC" on the event clock. */
function formatSent(ms, timeZone) {
  if (!Number.isFinite(ms)) return null;
  const instant = new Date(ms);
  const formatted = formatIn(timeZone, instant, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  return { text: withZone(formatted, instant), iso: instant.toISOString() };
}

/** "10:13 PM UTC" on the event clock. */
function formatClock(ms, timeZone) {
  const instant = new Date(ms);
  return withZone(formatIn(timeZone, instant, { hour: 'numeric', minute: '2-digit' }), instant);
}

const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** "the 500 most recent messages", or "the most recent message" for one. */
export const recentWindow = (n) => (n === 1 ? 'the most recent message' : `the ${n.toLocaleString('en-US')} most recent messages`);

/** The figure sentence: what is shown, over what window, read when. */
export function figureSentence({ count, scanned, searched, readAt }) {
  if (searched) {
    const found = count === 0 ? 'No matches' : plural(count, 'match', 'matches');
    return `${found} in ${recentWindow(scanned)}, read at ${readAt}.`;
  }
  const shown = count === 0 ? 'No messages' : plural(count, 'message', 'messages');
  return `${shown} shown, newest first, read at ${readAt}.`;
}

/**
 * A ruled table head cell, the one AdminTicketing draws. The table scrolls
 * inside its own box, so the head holds the top of that box.
 */
function GalleyHead({ children }) {
  return (
    <th
      scope="col"
      className="sticky top-0 z-10 border-b-admin-strong border-admin-rule-strong bg-admin-ground-soft px-sm py-xs text-start text-admin-xs font-semibold text-admin-ink-secondary"
    >
      {children}
    </th>
  );
}

const cellClass = 'px-sm py-xs align-top';
const quietWordClass = 'text-admin-ink-secondary';

function SourceCell({ source }) {
  if (!source) return <span className={quietWordClass}>None</span>;
  if (known(SOURCE_LABELS, source)) return SOURCE_LABELS[source];
  return <span className={quietWordClass}>Other email</span>;
}

/**
 * The state is a word. A plain send with no delivery event is the quiet
 * word "Sent"; an exception is a word in a badge whose tint agrees with it.
 * The reason, when the row stores one, sits under the word as text.
 */
function StatusCell({ row }) {
  const delivery = known(DELIVERY_WORDS, row.deliveryStatus) ? DELIVERY_WORDS[row.deliveryStatus] : null;
  let word;
  if (row.status === 'failed') word = <StatusBadge tone="error">Failed</StatusBadge>;
  else if (delivery) word = <StatusBadge tone={delivery.tone}>{delivery.label}</StatusBadge>;
  else if (row.status === 'sent') word = <span className={quietWordClass}>Sent</span>;
  else word = <span className={quietWordClass}>Status unavailable</span>;
  const reason = row.status === 'failed' ? 'Delivery failed. Check the email address before trying again.' : row.bounceReason ? 'The message could not be delivered. Check the email address.' : null;
  const gloss = row.status !== 'failed' ? delivery?.gloss : null;
  return (
    <>
      {word}
      {gloss ? <p className="mt-3xs max-w-[28ch] text-admin-xs text-admin-ink-secondary">{gloss}</p> : null}
      {reason ? (
        <p className="mt-3xs max-w-[28ch] break-words text-admin-xs text-admin-ink-secondary">{reason}</p>
      ) : null}
    </>
  );
}

/** The sandboxed frame, over a document emailPreview.js has already built. */
function PreviewFrame({ srcDoc, to }) {
  return (
    <>
      <iframe
        sandbox=""
        srcDoc={srcDoc}
        referrerPolicy="no-referrer"
        title={to ? `Message to ${to}` : 'Message with no recipient'}
        className="block h-[24rem] w-full rounded-admin border-admin-hairline border-admin-rule-hairline [color-scheme:light]"
      />
      <p className="text-admin-xs text-admin-ink-secondary">
        Links are inactive and images are hidden.
      </p>
    </>
  );
}

/**
 * A stored body: the frame when the HTML can be shown safely, the plain
 * text beside it or instead of it. The document is built once per body; a
 * body buildPreviewDoc refuses gets the plain text, open, and a line that
 * says why.
 */
function StoredBody({ message }) {
  const { html, text, bodyTruncated, to } = message;
  const srcDoc = useMemo(() => (html ? buildPreviewDoc(html) : null), [html]);
  const refused = Boolean(html) && srcDoc === null;
  return (
    <div className="flex flex-col gap-xs">
      {srcDoc ? <PreviewFrame srcDoc={srcDoc} to={to} /> : null}
      {refused ? (
        <p className="text-admin-sm text-admin-ink">
          {text
            ? 'The formatted preview is unavailable. The text preview is shown below.'
            : 'This message has no preview available.'}
        </p>
      ) : null}
      {text ? (
        <HelpDisclosure title="Text preview" help={"Read the email as plain text, without images or page styling."} defaultOpen={!srcDoc} className="text-admin-sm" titleClassName="admin-target cursor-pointer font-semibold text-admin-ink">
          <pre className="mt-2xs max-h-[24rem] overflow-auto whitespace-pre-wrap break-words font-admin-ui text-admin-sm text-admin-ink">
            {text}
          </pre>
        </HelpDisclosure>
      ) : null}
      {!html && !text ? <p className="text-admin-sm text-admin-ink">This message has no preview available.</p> : null}
      {bodyTruncated ? (
        <p className="text-admin-sm text-admin-ink-secondary">Only part of this message is available.</p>
      ) : null}
    </div>
  );
}

/** What an open row shows: the frame, the plain text, or the reason there is neither. */
function PreviewBody({ row, detail, onRetry }) {
  if (!row.bodyStored) {
    return (
      <p className="text-admin-sm text-admin-ink">
        This message is private because it contains a sign-in code or invitation link.
      </p>
    );
  }
  if (!detail || detail.state === 'loading' || detail.state === 'error') {
    const failed = detail?.state === 'error';
    return (
      <div className="flex flex-col items-start gap-xs">
        {failed ? <Notice tone="error" message={communicationsError(detail.error, 'This message could not be loaded. Try again.')} /> : <AdminLoadingState label="Loading the message…" />}
        {failed || detail?.retrying ? (
          <button type="button" className={secondaryButtonClass} aria-disabled={!failed} aria-busy={!failed} onClick={() => { if (failed) onRetry(); }}>
            {failed ? 'Retry preview' : 'Loading preview…'}
          </button>
        ) : null}
      </div>
    );
  }
  return <StoredBody message={detail.row} />;
}

export function EmailLogFigure({ count, scanned, searched, readAt, timeZone }) {
  return <p role="status" className="text-admin-sm text-admin-ink-secondary">{figureSentence({ count, scanned, searched, readAt: formatClock(readAt, timeZone) })}</p>;
}

/** Rows and sanitized previews; the controller owns every read and focus move. */
export default function EmailLogTable({ rows, timeZone, openId, details, previewRefs, onToggle, onRetry }) {
  const baseId = useId();
  return (
    <AdminTableScroll
      role="region"
      aria-label="Sent messages"
      tabIndex={0}
      className="max-h-[40rem] overflow-auto rounded-admin border-admin-hairline border-admin-rule-hairline bg-admin-ground-raised"
    >
      <table className="w-full min-w-[52rem] border-collapse text-admin-sm">
        <caption className="sr-only">Sent messages, newest first</caption>
        <thead>
          <tr>
            <GalleyHead>Sent</GalleyHead>
            <GalleyHead>To</GalleyHead>
            <GalleyHead>Subject</GalleyHead>
            <GalleyHead>Source</GalleyHead>
            <GalleyHead>Status</GalleyHead>
            <GalleyHead>Preview</GalleyHead>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const open = openId === row.id;
            const previewId = `${baseId}-preview-${index}`;
            const sent = formatSent(row.sentAt, timeZone);
            return (
              <Fragment key={row.id}>
                <tr className="border-b-admin-hairline border-admin-rule-hairline">
                  <td className={`${cellClass} whitespace-nowrap font-admin-data text-admin-ink-data`}>
                    {sent ? <time dateTime={sent.iso}>{sent.text}</time> : <span className={quietWordClass}>Unknown</span>}
                  </td>
                  <td className={`${cellClass} break-all font-admin-data text-admin-ink-data`}>
                    {row.to ?? <span className={`font-admin-ui ${quietWordClass}`}>No recipient</span>}
                  </td>
                  <td className={`${cellClass} break-words text-admin-ink`}>
                    {row.subject ?? (
                      <span className={quietWordClass}>{row.bodyStored ? 'No subject' : 'Not stored'}</span>
                    )}
                  </td>
                  <td className={`${cellClass} text-admin-ink`}>
                    <SourceCell source={row.source} />
                  </td>
                  <td className={cellClass}>
                    <StatusCell row={row} />
                  </td>
                  <td className={cellClass}>
                    <button
                      type="button"
                      ref={(node) => {
                        if (node) previewRefs.current.set(row.id, node);
                        else previewRefs.current.delete(row.id);
                      }}
                      className={linkButtonClass}
                      aria-expanded={open ? 'true' : 'false'}
                      aria-controls={previewId}
                      onClick={() => onToggle(row)}
                    >
                      {open ? 'Hide preview' : 'Preview'}
                    </button>
                  </td>
                </tr>
                {open ? (
                  <tr id={previewId} className="border-b-admin-hairline border-admin-rule-hairline">
                    <td colSpan={6} className="bg-admin-ground-soft px-sm py-sm">
                      <PreviewBody row={row} detail={details[row.id]} onRetry={() => onRetry(row.id)} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </AdminTableScroll>
  );
}

