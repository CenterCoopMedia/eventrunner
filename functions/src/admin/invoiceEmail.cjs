'use strict';

/**
 * Email an issued invoice (issue #208, part 4; the approved spec is the
 * 2026-10-20 comment on that issue). Two invoiceAdmin actions, staff tier:
 *
 *   previewSend  the subject, the bodies, the attachment name and the
 *                addresses the email would go to, and a `receipt`. Writes
 *                nothing.
 *   send         the same email with the invoice PDF attached. Needs the
 *                preview's `receipt` and a client-minted `sendId`.
 *
 * TO THE INVOICE ONLY. The recipient is the billing email on the invoice,
 * frozen at issue. A request cannot name another one: it may add one copy
 * address (`cc`) and a short note, both checked by shared/invoice
 * validateInvoiceSend. Every other field in the body is ignored. Display
 * names are never put in an address, so no name can add a header.
 *
 * ONLY A REAL INVOICE. An issued or a paid invoice can be sent. A draft has
 * no number and no PDF; a void invoice is not to be paid, so it is not sent
 * either. A read-only demo refuses the send (the handler and the email core
 * both check).
 *
 * WHAT THE PREVIEW SHOWED. The receipt is a SHA-256 over the invoice id and
 * revision, the addresses, the subject, both bodies, the file name and the
 * stream. Send composes the email again from the stored invoice, inside
 * the reservation transaction, and refuses it when the receipt differs: a
 * changed note, a payment recorded or a void since the preview all need a
 * new preview. A send does not change the revision, so it does not make
 * another tab's preview stale.
 *
 * THE TRANSACTIONAL STREAM. Invoice email is transactional mail. It goes on
 * `config/providers.email.messageStream` (Postmark's default `outbound` when
 * unset), never on the announcement stream: a stream set to the same name
 * as `announcementStream` is refused.
 *
 * A PROVIDER THAT CAN CARRY IT. The provider must declare `capabilities`
 * `attachments` and, for a copy, `cc` (email/providers). The console and
 * Postmark providers do; the webhook relay does not, so a deployment on it
 * is told to download the PDF instead. This is checked before anything is
 * recorded.
 *
 * ONE EMAIL PER CLICK. Each send carries a `sendId`, one per preview. In one
 * transaction, send reserves it on the invoice (`sends`, status `sending`)
 * before the mail goes. A repeat with the same `sendId` (a double click, a
 * retry after a lost answer) finds it there and sends nothing; the email
 * core's send-once claim (`invoice-send:{invoiceId}:{sendId}`) is the second
 * barrier. A send still in progress blocks any other. After the send, a
 * second transaction records the outcome and the provider's message id on
 * the invoice and writes the admin_logs row, together.
 *
 * NOT TWICE BY ACCIDENT. A new send to an address that was sent this
 * invoice (as the recipient or the copy) less than RESEND_WINDOW_MS ago is
 * refused unless staff confirm (`confirmResend: true`). A failed send does
 * not count. An uncertain one (the provider threw after the request left)
 * does, because the mail may have arrived. Whatever the addresses, one
 * invoice goes at most HOURLY_LIMIT times in an hour.
 *
 * A record left at `sending` for SENDING_STALE_MS (the instance died, or
 * the second transaction failed) is settled by the email core's claim: a
 * claim means the mail may have gone (`uncertain`); no claim means it never
 * reached the provider (`failed`). Its audit row names the person who
 * started it, and the requester who settled it as `settledBy`.
 *
 * While a send is reserved and not stale, mark paid, void and reopen wait
 * (invoices.cjs refuseWhileSending), so the email never states a status
 * the invoice no longer has.
 *
 * NO ADDRESSES IN THE AUDIT LOG. The admin_logs row names the send, the
 * number, the outcome and the message id. The addresses are on the invoice
 * and in the email log; the note text is only in the email itself. A
 * provider's error words can hold an address, so only its status code is
 * kept.
 */
const { createHash, randomUUID } = require('node:crypto');
const { formatMoney, isInvoiceId, validateInvoiceSend } = require('shared/invoice');
const { isBareEmailAddress } = require('shared/email');
const { buildInvoicePdf, internals: { longDate } } = require('./invoicePdf.cjs');
const { publicInvoice, internals: { InvoiceError, timeOf, SENDING_STALE_MS } } = require('./invoices.cjs');

const INVOICES = 'invoices';
const AUDIT = 'admin_logs';
const TEMPLATE_ID = 'invoice.send';
/** A second send to the same address inside this window needs a confirmation. */
const RESEND_WINDOW_MS = 15 * 60 * 1000;
/** At most this many sends of one invoice in an hour, confirmed or not. */
const HOURLY_LIMIT = 5;
const HOUR_MS = 60 * 60 * 1000;
/** The newest sends kept on the invoice. admin_logs keeps every one. */
const MAX_SEND_RECORDS = 50;
const SEND_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const RECEIPT_RE = /^[0-9a-f]{64}$/;
/** Statuses that count for the resend window: the mail went, or may have. */
const COUNTED = new Set(['sending', 'sent', 'uncertain']);

function fail(status, code, message) { throw new InvoiceError(status, code, message); }

function invalid(issues) {
  fail(400, 'bad-request', `Invalid email: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
}

function onceKeyFor(invoiceId, sendId) {
  return `invoice-send:${invoiceId}:${sendId}`;
}

/** One line, no control characters: for a subject or a greeting. */
function oneLine(value) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
}

/**
 * The transactional stream this deployment sends on, or a refusal when it
 * is the announcement stream. Null means the provider's default.
 */
function transactionalStream(config) {
  const { transactionalStream: resolve } = require('../email/stream.cjs');
  const channel = resolve(config);
  if (!channel.ok) {
    return { ok: false, reason: 'The transactional email stream is set to the announcement stream, so invoices are not emailed. Ask an operator to set config/providers.email.messageStream to the transactional stream.' };
  }
  return channel;
}

/** Why this provider cannot send the email, or null. */
function providerProblem(provider, { cc }) {
  if (provider?.capabilities?.attachments !== true) {
    return 'This site\'s email provider cannot send attachments, so the invoice cannot be emailed from here. Download the PDF and attach it to your own email.';
  }
  if (cc && provider?.capabilities?.cc !== true) {
    return 'This site\'s email provider cannot send a copy. Leave the copy address empty.';
  }
  return null;
}

/** The invoice as the email states it, or a refusal. */
function sendableInvoice(stored, id) {
  const invoice = publicInvoice(stored, id);
  if (invoice.status === 'draft' || !invoice.number) {
    fail(409, 'conflict', 'Issue the invoice first. A draft has no number, so it is not emailed.');
  }
  if (invoice.status === 'void') {
    fail(409, 'conflict', 'A void invoice is not sent. Duplicate it as a new draft to bill again.');
  }
  const to = invoice.billTo.email.toLowerCase();
  if (!isBareEmailAddress(to)) {
    fail(409, 'conflict', 'This invoice has no billing email, so it cannot be emailed. Download the PDF and send it yourself, or void it and duplicate it with a billing email.');
  }
  return { invoice, to };
}

function readSendInput(body, to) {
  const verdict = validateInvoiceSend({ cc: body.cc, note: body.note }, { to });
  if (!verdict.ok) invalid(verdict.issues);
  return verdict.value;
}

/**
 * The email for one invoice, rendered, and the receipt over it. Pure apart
 * from the template render.
 */
function composeInvoiceEmail({ invoice, to, cc, note, config, stream }) {
  const { render } = require('../email/render.cjs');
  const { getDefaultTemplate } = require('../email/templates.cjs');
  const { withLegalFooter } = require('../email/send.cjs');
  const number = oneLine(invoice.number);
  const issuerName = oneLine(invoice.issuer?.name) || oneLine(config?.event?.name) || 'the organizers';
  const contactName = oneLine(invoice.billTo.contactName);
  const total = formatMoney(invoice.totals.total, invoice.currency);
  let summary = `Invoice ${number} for ${total} is attached as a PDF.`;
  if (invoice.status === 'paid' && invoice.payment?.paidOn) {
    summary += ` It was paid on ${longDate(invoice.payment.paidOn)}. This copy is for your records.`;
  } else if (invoice.dueDate) {
    summary += ` Payment is due by ${longDate(invoice.dueDate)}.`;
  } else {
    summary += ' Payment is due on receipt.';
  }
  const rendered = render({
    template: getDefaultTemplate(TEMPLATE_ID),
    tokenValues: {
      invoice_number: number,
      issuer_name: issuerName,
      greeting: contactName ? `Hello ${contactName},` : 'Hello,',
      invoice_summary: summary,
      staff_note: note,
    },
    config,
  });
  const delivered = withLegalFooter(rendered, config);
  const issuerEmail = typeof invoice.issuer?.email === 'string' ? invoice.issuer.email.toLowerCase() : '';
  const replyTo = isBareEmailAddress(issuerEmail)
    ? issuerEmail
    : (config?.event?.sender?.replyTo || config?.event?.sender?.email || null);
  const subject = oneLine(rendered.subject);
  const filename = `${number.replace(/[^A-Za-z0-9-]/g, '_')}.pdf`;
  const preview = { to, cc, replyTo, subject, html: delivered.html, text: delivered.text, filename };
  const receipt = createHash('sha256').update(JSON.stringify({
    v: 1, invoiceId: invoice.id, revision: invoice.revision, to, cc, replyTo, subject,
    html: delivered.html, text: delivered.text, filename, stream,
  }), 'utf8').digest('hex');
  const message = {
    to,
    ...(cc ? { cc } : {}),
    ...(replyTo ? { replyTo } : {}),
    subject,
    html: rendered.html,
    text: rendered.text,
    hasLegalFooterHtml: rendered.hasLegalFooterHtml,
    hasLegalFooterText: rendered.hasLegalFooterText,
    tag: TEMPLATE_ID,
    source: 'invoice',
    storeRendered: true,
    ...(stream ? { messageStream: stream } : {}),
  };
  return { preview, receipt, message, filename };
}

/** The most recent counted send to `to` or `cc` inside the window, or null. */
function recentSendTo(sends, addresses, nowMs) {
  let found = null;
  for (const entry of Array.isArray(sends) ? sends : []) {
    if (!COUNTED.has(entry?.status)) continue;
    const at = timeOf(entry.at);
    if (!Number.isFinite(at) || nowMs - at >= RESEND_WINDOW_MS) continue;
    const hit = [entry.to, entry.cc].find((address) => typeof address === 'string' && addresses.includes(address));
    if (hit && (!found || at > found.atMs)) found = { atMs: at, to: hit };
  }
  return found ? { at: new Date(found.atMs).toISOString(), to: found.to } : null;
}

/**
 * The admin_logs row for one send. A send settled by a later request stays
 * the act of the person who started it (`entry.by`); the requester whose
 * send settled it is `details.settledBy`.
 */
function auditRow(tx, db, { actor, now, id, number, entry, settled = false }) {
  const uid = settled && typeof entry.by === 'string' ? entry.by : actor.uid;
  tx.create(db.collection(AUDIT).doc(randomUUID()), {
    action: entry.status === 'failed' ? 'invoices.email-failed' : 'invoices.emailed',
    docPath: `${INVOICES}/${id}`,
    uid,
    actorUid: uid,
    at: now(),
    invoiceId: id,
    details: {
      sendId: entry.sendId,
      number,
      status: entry.status,
      providerMessageId: entry.providerMessageId ?? null,
      copy: Boolean(entry.cc),
      note: entry.note === true,
      resend: entry.resend === true,
      ...(entry.providerStatus ? { providerStatus: entry.providerStatus } : {}),
      ...(settled ? { settled: true, settledBy: actor.uid } : {}),
    },
  });
}

async function previewSend({ db, getConfig, getMailer, body, now }) {
  if (!isInvoiceId(body.invoiceId)) fail(400, 'bad-request', 'invoiceId: Choose an invoice from the list.');
  const id = body.invoiceId;
  const snap = await db.collection(INVOICES).doc(id).get();
  if (!snap.exists) fail(404, 'not-found', 'Invoice not found. It may have been deleted.');
  const { invoice, to } = sendableInvoice(snap.data(), id);
  const { cc, note } = readSendInput(body, to);
  const config = await getConfig();
  const channel = transactionalStream(config);
  const { preview, receipt } = composeInvoiceEmail({ invoice, to, cc, note, config, stream: channel.ok ? channel.stream : null });
  let cannotSendReason = channel.ok ? null : channel.reason;
  if (!cannotSendReason) {
    try {
      cannotSendReason = providerProblem(getMailer().provider, { cc });
    } catch {
      cannotSendReason = 'Email is not set up for this site, so the invoice cannot be emailed. Download the PDF instead.';
    }
  }
  return {
    preview,
    receipt,
    canSend: cannotSendReason === null,
    cannotSendReason,
    recentSend: recentSendTo(snap.data().sends, [to, cc].filter(Boolean), now().getTime()),
    resendWindowMinutes: RESEND_WINDOW_MS / 60000,
  };
}

async function sendInvoice({ db, actor, body, now, getConfig, getMailer, log }) {
  const { claimIdForOnceKey } = require('../email/send.cjs').internals;
  if (!isInvoiceId(body.invoiceId)) fail(400, 'bad-request', 'invoiceId: Choose an invoice from the list.');
  if (typeof body.sendId !== 'string' || !SEND_ID_RE.test(body.sendId)) fail(400, 'bad-request', 'sendId: Preview the email again, then send.');
  if (typeof body.receipt !== 'string' || !RECEIPT_RE.test(body.receipt)) fail(400, 'bad-request', 'receipt: Preview the email again, then send.');
  if (body.confirmResend !== undefined && typeof body.confirmResend !== 'boolean') fail(400, 'bad-request', 'confirmResend: Must be true or false.');
  const id = body.invoiceId;
  const { sendId } = body;
  const ref = db.collection(INVOICES).doc(id);

  // Refusals that need no reservation come first: the invoice, the input,
  // the stream and the provider.
  const first = await ref.get();
  if (!first.exists) fail(404, 'not-found', 'Invoice not found. It may have been deleted.');
  const { to } = sendableInvoice(first.data(), id);
  const { cc, note } = readSendInput(body, to);
  const config = await getConfig();
  const channel = transactionalStream(config);
  if (!channel.ok) fail(409, 'stream-misconfigured', channel.reason);
  let mailer;
  try {
    mailer = getMailer();
  } catch (error) {
    log.error('invoice email provider unavailable', { code: error?.code || 'internal' });
    fail(503, 'email-unavailable', 'Email is not set up for this site, so the invoice was not emailed. Download the PDF instead.');
  }
  const problem = providerProblem(mailer.provider, { cc });
  if (problem) fail(409, cc && mailer.provider?.capabilities?.attachments === true ? 'cc-unsupported' : 'attachments-unsupported', problem);

  // Reserve in one transaction: check the status and the preview against the
  // stored invoice, settle a stale send, apply the window, and mark this one
  // `sending`.
  const nowMs = now().getTime();
  const reservation = await db.runTransaction(async (tx) => {
    const { checkDemoWrites } = require('../core/demoWrites.cjs');
    const policy = await checkDemoWrites({ db, transaction: tx });
    if (!policy.ok) fail(policy.status, policy.code, policy.message);
    const snap = await tx.get(ref);
    if (!snap.exists) fail(404, 'not-found', 'Invoice not found. It may have been deleted.');
    const stored = snap.data();
    let sends = Array.isArray(stored.sends) ? stored.sends.map((entry) => ({ ...entry })) : [];

    // An abandoned send: settle it by the email core's claim.
    const stale = sends.filter((entry) => entry?.status === 'sending' && nowMs - timeOf(entry.at) >= SENDING_STALE_MS);
    const claims = await Promise.all(stale.map((entry) => tx.get(db.collection('email_claims').doc(claimIdForOnceKey(onceKeyFor(id, entry.sendId))))));
    const settled = [];
    stale.forEach((entry, index) => {
      entry.status = claims[index].exists ? 'uncertain' : 'failed';
      settled.push(entry);
    });

    const existing = sends.find((entry) => entry?.sendId === sendId);
    if (existing && existing.status !== 'sending') {
      if (settled.length) {
        tx.update(ref, { sends });
        for (const entry of settled) auditRow(tx, db, { actor, now, id, number: stored.number, entry, settled: true });
      }
      return { repeated: true, entry: existing, stored: { ...stored, sends } };
    }
    if (existing || sends.some((entry) => entry?.status === 'sending')) {
      fail(409, 'in-progress', 'This invoice is being emailed now. Reload the invoice in a minute to see the result.');
    }

    const { invoice } = sendableInvoice(stored, id);
    const composed = composeInvoiceEmail({ invoice, to, cc, note, config, stream: channel.stream });
    if (composed.receipt !== body.receipt) {
      fail(409, 'stale-preview', 'The invoice or the email changed after the preview. Preview the email again, then send.');
    }
    const lastHour = sends.filter((each) => COUNTED.has(each?.status) && nowMs - timeOf(each.at) < HOUR_MS).length;
    if (lastHour >= HOURLY_LIMIT) {
      fail(429, 'rate-limited', `${invoice.number} was emailed ${lastHour} times in the last hour. Wait an hour before you send it again.`);
    }
    const recent = recentSendTo(sends, [to, cc].filter(Boolean), nowMs);
    if (recent && body.confirmResend !== true) {
      fail(409, 'recent-send', `${invoice.number} was emailed to ${recent.to} less than ${RESEND_WINDOW_MS / 60000} minutes ago. Confirm to send it again.`);
    }
    const entry = {
      sendId, status: 'sending', to, cc, by: actor.uid, at: new Date(nowMs),
      note: note !== '', resend: Boolean(recent),
    };
    sends = [...sends, entry].slice(-MAX_SEND_RECORDS);
    tx.update(ref, { sends });
    for (const each of settled) auditRow(tx, db, { actor, now, id, number: stored.number, entry: each, settled: true });
    return { repeated: false, entry, invoice, composed };
  });

  if (reservation.repeated) {
    if (reservation.entry.status === 'failed') {
      fail(502, 'send-failed', 'This email was not sent. Preview the email again to try again.');
    }
    return { outcome: reservation.entry.status, repeated: true, stored: reservation.stored };
  }

  // The PDF from the same record the reservation checked.
  const { invoice, composed } = reservation;
  let result;
  try {
    const bytes = await buildInvoicePdf({ invoice, theme: config?.theme ?? null });
    result = await mailer.send({
      ...composed.message,
      attachments: [{ filename: composed.filename, contentType: 'application/pdf', content: Buffer.from(bytes).toString('base64') }],
      onceKey: onceKeyFor(id, sendId),
    });
  } catch (error) {
    // The email core never throws for a provider fault; a throw here is the
    // PDF or a claim write, before or around the request.
    log.error('invoice email failed', { code: error?.code || 'internal' });
    result = { status: 'failed', error: 'internal' };
  }
  let status = 'failed';
  if (result?.status === 'sent' && !result.skipped) status = 'sent';
  else if (result?.ambiguous || result?.skipped) status = 'uncertain';

  // Record the outcome and its audit row together. When this write fails,
  // the mail has still gone (or not): the answer says what happened, and the
  // record left at `sending` is settled later by the claim.
  let saved = null;
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const stored = snap.data();
      const sends = (Array.isArray(stored.sends) ? stored.sends : []).map((entry) => ({ ...entry }));
      let entry = sends.find((each) => each?.sendId === sendId);
      if (!entry) {
        entry = { ...reservation.entry };
        sends.push(entry);
      }
      entry.status = status;
      entry.providerMessageId = typeof result?.providerMessageId === 'string' ? result.providerMessageId : null;
      if (status === 'sent') entry.sentAt = now();
      if (status === 'failed' && Number.isInteger(result?.providerStatus)) entry.providerStatus = result.providerStatus;
      const kept = sends.slice(-MAX_SEND_RECORDS);
      tx.update(ref, { sends: kept });
      auditRow(tx, db, { actor, now, id, number: stored.number, entry });
      saved = { ...stored, sends: kept };
    });
  } catch (error) {
    log.error('invoice email record failed', { code: error?.code || 'internal' });
  }

  if (status === 'failed') {
    const detail = Number.isInteger(result?.providerStatus) ? ` The email provider refused it (status ${result.providerStatus}).` : '';
    fail(502, 'send-failed', `The invoice was not emailed.${detail} Check the billing email and try again.`);
  }
  return { outcome: status, repeated: false, stored: saved ?? first.data() };
}

module.exports = {
  previewSend,
  sendInvoice,
  composeInvoiceEmail,
  internals: { RESEND_WINDOW_MS, SENDING_STALE_MS, HOURLY_LIMIT, MAX_SEND_RECORDS, TEMPLATE_ID, onceKeyFor, recentSendTo, transactionalStream },
};
