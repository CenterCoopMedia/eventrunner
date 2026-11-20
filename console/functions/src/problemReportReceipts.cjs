'use strict';

const { SCREENSHOT_ID_RE, screenshotRef, validScreenshotIndex, writeScreenshots } = require('shared/screenshots');
const { ConsoleError } = require('./http.cjs');
const { requireOperator } = require('./reviewAccess.cjs');
const { toIso, toMillis } = require('./access.cjs');

const RECEIPTS = 'problem_report_receipts';
const RECEIPT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISSING = 'This report or screenshot is no longer available.';

async function storeProblemReportReceipt({ db, now }, id, report, reporter, render) {
  const createdAt = new Date(now());
  const expiresAt = new Date(createdAt.getTime() + RECEIPT_TTL_MS);
  const ref = db.collection(RECEIPTS).doc(id);
  let rendering;
  return db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) return false;
    rendering ??= render();
    const images = await rendering;
    tx.create(ref, {
      category: report.category,
      description: report.description,
      url: report.url,
      project: reporter.project,
      reporterEmail: reporter.email,
      createdAt,
      expiresAt,
      screenshotCount: images.length,
    });
    writeScreenshots(db, tx, RECEIPTS, id, images, { expiresAt });
    return true;
  });
}

function available(data, now) {
  return data && toMillis(data.expiresAt) > now();
}

function receiptView(doc) {
  const { category, description, project, createdAt, expiresAt, url, screenshotCount } = doc.data();
  return { id: doc.id, category, description, project, createdAt: toIso(createdAt), expiresAt: toIso(expiresAt), url, screenshotCount };
}

async function getProblemReportReceipts({ db, now }, { user, body }) {
  await requireOperator(db, user);
  if (body.id !== undefined) {
    if (typeof body.id !== 'string' || !SCREENSHOT_ID_RE.test(body.id)) throw new ConsoleError(404, 'not-found', MISSING);
    const doc = await db.collection(RECEIPTS).doc(body.id).get();
    if (!available(doc.data(), now)) throw new ConsoleError(404, 'not-found', MISSING);
    return { body: { receipt: { ...receiptView(doc), reporterEmail: doc.data().reporterEmail ?? null } } };
  }
  const list = await db.collection(RECEIPTS).orderBy('createdAt', 'desc').limit(30).get();
  const receipts = list.docs.filter((doc) => available(doc.data(), now)).map(receiptView);
  return { body: { receipts } };
}

async function readProblemReportScreenshot({ db, now }, { user, body }) {
  await requireOperator(db, user);
  const { id, index } = body;
  if (typeof id !== 'string' || !SCREENSHOT_ID_RE.test(id) || !validScreenshotIndex(index)) {
    throw new ConsoleError(404, 'not-found', MISSING);
  }
  const image = await db.runTransaction(async (tx) => {
    const receipt = (await tx.get(db.collection(RECEIPTS).doc(id))).data();
    if (!available(receipt, now) || !validScreenshotIndex(index, receipt.screenshotCount)) return null;
    const stored = (await tx.get(screenshotRef(db, RECEIPTS, id, index))).data();
    return available(stored, now) ? stored.image : null;
  }, { readOnly: true });
  if (!image) throw new ConsoleError(404, 'not-found', MISSING);
  return { body: { image: Buffer.from(image).toString('base64') } };
}

module.exports = { storeProblemReportReceipt, getProblemReportReceipts, readProblemReportScreenshot };
