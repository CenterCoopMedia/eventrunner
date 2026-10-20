'use strict';

/**
 * invoicePdf — the PDF of one issued invoice (issue #209).
 *
 * POST `{ invoiceId }`, staff tier. The answer is the PDF itself, saved by
 * the browser as `<number>.pdf`. A draft has no PDF: it has no number, no
 * issue date and no issuer yet, and a document that looks like an invoice
 * but is not one should not exist. The PDF is built on each request from
 * the frozen record, so it never changes after issue, whatever happens to
 * the organization or the settings later. A paid invoice says when it was
 * paid; a void one says VOID and why.
 *
 * Reading a PDF writes nothing, so a read-only demo serves it too.
 *
 * TEXT IS DATA. Every string comes from publicInvoice, which cleans stored
 * text again on read (control, direction and invisible characters), then
 * through sanitizeForFont for the standard font. pdf-lib writes drawn text
 * as hex strings, so a parenthesis or a PDF keyword in a name stays text
 * and cannot end the string or add an operator.
 *
 * The layout helpers (theme colours, text fitting, font safety, wrapping)
 * are shared with the schedule PDF in ../pdf/kit.cjs.
 */
const { requireAdmin } = require('../core/auth.cjs');
const { sendError } = require('../core/errors.cjs');
const { formatMoney, isInvoiceId, PAYMENT_METHOD_WORDS } = require('shared/invoice');
const { resolveThemeColors, sanitizeForFont, wrapText, fitText } = require('../pdf/kit.cjs');
const { publicInvoice } = require('./invoices.cjs');

const PAGE_SIZE = [612, 792]; // US Letter, points
const MARGIN = 48;
const HEADER_HEIGHT = 84;
const FOOTER_SPACE = 36;
const BODY_SIZE = 10;
const LINE_GAP = 4;

/** "2026-10-20" → "October 20, 2026". The date is a calendar date; no zone moves it. */
function longDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day)));
}

/**
 * Build the PDF. Pure apart from pdf-lib: no Firestore and no network.
 *
 * @param {{ invoice: ReturnType<typeof publicInvoice>, theme?: object|null }} args
 * @returns {Promise<Uint8Array>}
 */
async function buildInvoicePdf({ invoice, theme = null }) {
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
  const doc = await PDFDocument.create();
  const body = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const colors = resolveThemeColors(theme);
  const color = (key) => rgb(colors[key].r, colors[key].g, colors[key].b);
  const [pageWidth, pageHeight] = PAGE_SIZE;
  const contentWidth = pageWidth - MARGIN * 2;
  const right = pageWidth - MARGIN;
  const money = (amount) => formatMoney(amount, invoice.currency);
  // Line by line: the font cannot encode a line break, so a whole block
  // cleaned at once would lose its breaks.
  const safe = (font, text) => (typeof text === 'string' ? text : '')
    .split('\n').map((line) => sanitizeForFont(font, line)).join('\n');
  const number = invoice.number ?? '';
  const issuerName = invoice.issuer?.name || '';

  doc.setTitle(safe(body, `Invoice ${number}`));
  doc.setSubject(safe(body, `Invoice ${number}${issuerName ? ` from ${issuerName}` : ''}`));
  doc.setProducer('run-of-show');
  doc.setCreator('run-of-show');

  let page;
  let y;

  function drawHeader(continued) {
    page.drawRectangle({ x: 0, y: pageHeight - HEADER_HEIGHT, width: pageWidth, height: HEADER_HEIGHT, color: color('primary') });
    const title = continued ? `${number} (continued)` : 'Invoice';
    const titleWidth = bold.widthOfTextAtSize(title, 18);
    page.drawText(title, { x: right - titleWidth, y: pageHeight - 40, size: 18, font: bold, color: color('surface') });
    if (!continued) {
      const numberWidth = bold.widthOfTextAtSize(number, 12);
      page.drawText(number, { x: right - numberWidth, y: pageHeight - 60, size: 12, font: bold, color: color('surface') });
    }
    const name = safe(bold, issuerName);
    if (name) {
      const fit = fitText({
        measure: (text, size) => bold.widthOfTextAtSize(text, size),
        text: name, maxWidth: contentWidth - Math.max(titleWidth, 120) - 24, maxSize: 18, minSize: 10,
      });
      const shown = wrapText({ font: bold, text: name, size: fit.size, maxWidth: contentWidth - Math.max(titleWidth, 120) - 24 })[0];
      page.drawText(shown, { x: MARGIN, y: pageHeight - 40, size: fit.size, font: bold, color: color('surface') });
    }
    y = pageHeight - HEADER_HEIGHT - 28;
  }

  function newPage(continued) {
    page = doc.addPage(PAGE_SIZE);
    drawHeader(continued);
  }

  /** Room for `height` more points on this page, or a new page. */
  function ensure(height, onNewPage) {
    if (y - height >= MARGIN + FOOTER_SPACE) return false;
    newPage(true);
    onNewPage?.();
    return true;
  }

  /** Wrapped text at x within width; returns the lines drawn. */
  function paragraph(text, { x = MARGIN, width = contentWidth, font = body, size = BODY_SIZE, tone = 'ink' } = {}) {
    const lines = wrapText({ font, text: safe(font, text), size, maxWidth: width });
    for (const line of lines) {
      ensure(size + LINE_GAP);
      if (line) page.drawText(line, { x, y, size, font, color: color(tone) });
      y -= size + LINE_GAP;
    }
    return lines.length;
  }

  function heading(text) {
    ensure(BODY_SIZE * 3);
    y -= 6;
    page.drawText(text, { x: MARGIN, y, size: 11, font: bold, color: color('accent') });
    y -= 11 + LINE_GAP + 2;
  }

  newPage(false);

  // Status in words, never colour alone.
  if (invoice.status === 'void') {
    page.drawText('VOID', { x: MARGIN, y, size: 22, font: bold, color: color('ink') });
    y -= 22 + LINE_GAP;
    paragraph(`This invoice is void. Reason: ${invoice.voided?.reason || 'None given.'}`, { font: bold });
    y -= 6;
  } else if (invoice.status === 'paid' && invoice.payment) {
    const method = PAYMENT_METHOD_WORDS[invoice.payment.method] ?? 'Other';
    const note = invoice.payment.note ? ` ${invoice.payment.note}` : '';
    paragraph(`Paid on ${longDate(invoice.payment.paidOn)}. Method: ${method}.${note}`, { font: bold });
    y -= 6;
  }

  // From and bill to, side by side. An address may hold many lines; when
  // the two blocks will not fit on this page side by side, they stack, and
  // each runs onto the next page like any other paragraph.
  const columnWidth = (contentWidth - 24) / 2;
  const fromLines = [
    issuerName,
    ...(invoice.issuer?.address ? invoice.issuer.address.split('\n') : []),
    invoice.issuer?.email,
    invoice.issuer?.taxId ? `Tax ID: ${invoice.issuer.taxId}` : '',
  ].filter(Boolean);
  const billLines = [
    invoice.billTo?.name,
    invoice.billTo?.contactName,
    invoice.billTo?.email,
    ...(invoice.billTo?.address ? invoice.billTo.address.split('\n') : []),
  ].filter(Boolean);
  const heightOf = (lines) => lines.reduce(
    (sum, line, index) => sum + Math.max(1, wrapText({ font: index === 0 ? bold : body, text: safe(body, line), size: BODY_SIZE, maxWidth: columnWidth }).length),
    0,
  ) * (BODY_SIZE + LINE_GAP) + 17;
  const sideBySide = Math.max(heightOf(fromLines), heightOf(billLines)) <= y - MARGIN - FOOTER_SPACE;
  const block = (title, lines, x, width, boldFirst) => {
    ensure(40);
    page.drawText(title, { x, y, size: 11, font: bold, color: color('accent') });
    y -= 11 + LINE_GAP + 2;
    lines.forEach((line, index) => paragraph(line, { x, width, font: boldFirst && index === 0 ? bold : body }));
  };
  if (sideBySide) {
    const top = y;
    block('From', fromLines, MARGIN, columnWidth, false);
    const leftBottom = y;
    y = top;
    block('Bill to', billLines, MARGIN + columnWidth + 24, columnWidth, true);
    y = Math.min(y, leftBottom) - 10;
  } else {
    block('From', fromLines, MARGIN, contentWidth, false);
    y -= 6;
    block('Bill to', billLines, MARGIN, contentWidth, true);
    y -= 10;
  }
  ensure(40);

  // The details row.
  const details = [
    ['Invoice number', number],
    ['Issue date', longDate(invoice.issueDate)],
    ['Due date', invoice.dueDate ? longDate(invoice.dueDate) : 'On receipt'],
    ['Currency', (invoice.currency || '').toUpperCase()],
    ...(invoice.reference ? [['Reference', invoice.reference]] : []),
  ];
  const detailWidth = contentWidth / details.length;
  details.forEach(([label, value], index) => {
    const x = MARGIN + index * detailWidth;
    page.drawText(label, { x, y, size: 8, font: body, color: color('inkMuted') });
    const shown = wrapText({ font: bold, text: safe(bold, value), size: BODY_SIZE, maxWidth: detailWidth - 8 })[0] ?? '';
    if (shown) page.drawText(shown, { x, y: y - 13, size: BODY_SIZE, font: bold, color: color('ink') });
  });
  y -= 36;

  // The lines table.
  const amountX = right;
  const unitX = right - 90;
  const quantityX = right - 180;
  const descriptionWidth = quantityX - 40 - MARGIN;
  const drawRight = (text, x, font = body, tone = 'ink', size = BODY_SIZE) => {
    const shown = safe(font, text);
    page.drawText(shown, { x: x - font.widthOfTextAtSize(shown, size), y, size, font, color: color(tone) });
  };
  function tableHeader() {
    page.drawText('Description', { x: MARGIN, y, size: 9, font: bold, color: color('inkMuted') });
    drawRight('Qty', quantityX, bold, 'inkMuted', 9);
    drawRight('Unit price', unitX, bold, 'inkMuted', 9);
    drawRight('Amount', amountX, bold, 'inkMuted', 9);
    y -= 6;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 0.75, color: color('inkMuted') });
    y -= BODY_SIZE + 6;
  }
  tableHeader();
  for (const line of invoice.lines ?? []) {
    const description = wrapText({ font: body, text: safe(body, line.description), size: BODY_SIZE, maxWidth: descriptionWidth });
    const rowHeight = Math.max(description.length, 1) * (BODY_SIZE + LINE_GAP) + 6;
    // Keep a row on one page; a row taller than a page starts a new one and runs on.
    ensure(Math.min(rowHeight, pageHeight / 2), tableHeader);
    drawRight(String(line.quantity), quantityX);
    drawRight(money(line.unitAmount), unitX);
    drawRight(money(line.amount), amountX);
    for (const text of description) {
      ensure(BODY_SIZE + LINE_GAP, tableHeader);
      if (text) page.drawText(text, { x: MARGIN, y, size: BODY_SIZE, font: body, color: color('ink') });
      y -= BODY_SIZE + LINE_GAP;
    }
    y -= 6;
  }
  page.drawLine({ start: { x: MARGIN, y: y + 14 }, end: { x: right, y: y + 14 }, thickness: 0.5, color: color('inkMuted') });
  y -= 2;

  // Totals, right-aligned.
  const labelX = unitX - 20;
  const totalRows = [
    ['Subtotal', money(invoice.totals?.subtotal ?? 0), body],
    ...(invoice.adjustments ?? []).map((row) => [
      row.label || (row.kind === 'tax' ? 'Tax' : 'Discount'),
      row.kind === 'discount' ? `-${money(row.amount)}` : money(row.amount),
      body,
    ]),
  ];
  for (const [label, value, font] of totalRows) {
    ensure(BODY_SIZE + LINE_GAP);
    const shownLabel = wrapText({ font, text: safe(font, label), size: BODY_SIZE, maxWidth: labelX - MARGIN - 40 })[0] ?? '';
    drawRight(shownLabel, labelX, font, 'inkMuted');
    drawRight(value, amountX, font);
    y -= BODY_SIZE + LINE_GAP;
  }
  ensure(30);
  y -= 4;
  page.drawLine({ start: { x: labelX - 120, y: y + 12 }, end: { x: right, y: y + 12 }, thickness: 1, color: color('ink') });
  drawRight('Total', labelX, bold, 'ink', 12);
  drawRight(money(invoice.totals?.total ?? 0), amountX, bold, 'ink', 12);
  y -= 12 + LINE_GAP + 12;

  // How to pay; a void invoice is not to be paid, so it has none.
  if (invoice.status !== 'void' && invoice.issuer?.paymentInstructions) {
    heading('How to pay');
    paragraph(invoice.issuer.paymentInstructions);
  }
  if (invoice.notes) {
    heading('Notes');
    paragraph(invoice.notes);
  }

  // Page numbers, now that the count is known.
  const pages = doc.getPages();
  pages.forEach((each, index) => {
    const label = `Page ${index + 1} of ${pages.length}`;
    each.drawText(label, { x: right - body.widthOfTextAtSize(label, 8), y: MARGIN - 16, size: 8, font: body, color: color('inkMuted') });
    const footer = safe(body, number);
    if (footer) each.drawText(footer, { x: MARGIN, y: MARGIN - 16, size: 8, font: body, color: color('inkMuted') });
  });

  return doc.save();
}

/**
 * @param {{ db: object, auth: object, getConfig: () => Promise<object>, log?: object }} deps
 */
function createInvoicePdfHandler({ db, auth, getConfig, log = console }) {
  return async function invoicePdf(req, res) {
    res.set('Cache-Control', 'private, no-store');
    if (req.method !== 'POST') { res.set('Allow', 'POST'); return sendError(res, 405, 'method-not-allowed', 'Use POST.'); }
    const actor = await requireAdmin({ db, auth, getConfig }, req, { tier: 'staff' });
    if (!actor.ok) return sendError(res, actor.status, actor.code, actor.message);
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    if (!isInvoiceId(body.invoiceId)) return sendError(res, 400, 'bad-request', 'invoiceId: Choose an invoice from the list.');
    try {
      const snap = await db.collection('invoices').doc(body.invoiceId).get();
      if (!snap.exists) return sendError(res, 404, 'not-found', 'Invoice not found. It may have been deleted.');
      const invoice = publicInvoice(snap.data(), body.invoiceId);
      if (invoice.status === 'draft' || !invoice.number) {
        return sendError(res, 409, 'conflict', 'Issue the invoice first. A draft has no number, so it has no PDF.');
      }
      const config = await getConfig();
      const bytes = await buildInvoicePdf({ invoice, theme: config?.theme ?? null });
      res.status(200);
      res.set('Content-Type', 'application/pdf');
      // The number matches the settings prefix rule (capitals, digits and
      // hyphens), so it is safe in the header; anything else is replaced.
      res.set('Content-Disposition', `attachment; filename="${invoice.number.replace(/[^A-Za-z0-9-]/g, '_')}.pdf"`);
      return res.send(Buffer.from(bytes));
    } catch (error) {
      log.error('invoice PDF failed', { code: error?.code || 'internal' });
      return sendError(res, 503, 'unavailable', 'The invoice PDF could not be made. Try again.');
    }
  };
}

/** Deployable export: invoicePdf. */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  return {
    invoicePdf: onRequest({ region }, async (req, res) => {
      const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
      if (applyCors(req, res, { allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS), methods: ['POST'] })) return;
      const { getDb } = require('../core/firestore.cjs');
      const { getEventConfig } = require('../core/config.cjs');
      const { getAuth } = require('firebase-admin/auth');
      const db = getDb();
      await createInvoicePdfHandler({ db, auth: getAuth(), getConfig: () => getEventConfig({ db }) })(req, res);
    }),
  };
}

module.exports = {
  buildInvoicePdf,
  createInvoicePdfHandler,
  get handlers() { return buildHandlers(); },
  internals: { longDate },
};
