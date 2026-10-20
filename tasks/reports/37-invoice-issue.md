# 37-invoice-issue: issue, the PDF, mark paid, void, duplicate and export (#209)

Branch `joe/blissful-einstein-9qvtd1-37-invoice-issue`, from `origin/main` cfbcc48.
Part 3 of the five-part invoicing plan (spec: the 2026-10-20 comment on #208).

## What changed

- **Shared** (`packages/shared/src/invoice.cjs`, `.mjs` shim): `PAYMENT_METHODS`
  (bank transfer, check, card, cash, other) and their words, `invoiceDateIn` (a date on
  the event clock), `validatePayment` (a real date not after today, a known method, an
  optional note), `validateVoidReason` (required), and `issueProblems` (a line, a due
  date not before the issue date, an issuer name in the settings).
- **invoiceAdmin** (`functions/src/admin/invoices.cjs`): `issue`, `markPaid`, `void`
  (operator only) and `duplicate`. Issue reads the draft, the settings, the counter and
  `config/event` in one transaction and writes the invoice and `lastNumber + 1`
  together, so no number is lost or shared. A counter that is not a whole number, a
  `sequence` another invoice holds, settings that fail their checks, and an unsupported
  stored currency are refused. Issue freezes the recomputed totals, the issue date and a
  copy of the issuer block. Void keeps the number and any payment. Duplicate takes a
  client-minted id and is safe to retry. Every answer with an invoice says `canVoid`.
  Every write refuses on a read-only demo and writes its `admin_logs` row in the same
  transaction.
- **invoicePdf** (`functions/src/admin/invoicePdf.cjs`, new deployed function, in
  `functions/index.js` and `.github/smoke-endpoints.json`): staff POST, answers the PDF
  as `<number>.pdf`. Built from `publicInvoice` (text cleaned on read), each line made
  safe for the font, wrapped with the new kit helper `wrapText`
  (`functions/src/pdf/kit.cjs`). A draft is refused. Paid and void are stated in words.
- **Editor** (`AdminInvoiceEditor.jsx`, new `InvoiceRecord.jsx`, new `invoicePdf.js`):
  Issue invoice with a confirmation naming the next number; a save is asked for first
  when the form has changes. An issued invoice shows its frozen record, Download PDF,
  Mark paid, Duplicate as a new draft, and Void for an operator.
- **Export**: an `invoices` dataset in Data export (staff), a `billing` part in the
  event data package (`billing/invoices.json`, `billing/invoices.csv`;
  `invoice_settings` and `invoice_counters` excluded), and the repeat-event template
  leaves the three collections behind.
- **Test fake** (`functions/src/cms/firestoreFake.cjs`): the commit check awaited its
  query reads between the document check and the writes, so concurrent transactions
  with a query in their read set all committed. Fixed; the concurrent-issue test caught it.
- **Docs**: ADMIN_GUIDE (issue, PDF, mark paid, void, correct, export rows, tiers),
  functions/README, CHANGELOG, ROADMAP (#208 and #209 ticked).

## Done when (#209)

- "a sent invoice downloads with the frozen details": `e2e/invoices.spec.js` "a draft is
  issued as INV-0001, downloaded, marked paid and voided" issues on the real page,
  downloads the PDF, and finds the number, both parties, the line, the total and the
  payment instructions in it.
- "later organization edits do not change it": the same E2E renames the issuer in the
  settings after issue and the PDF does not carry the new name; the bill-to block is a
  snapshot on the invoice and is never read from the organization again.
  `invoices.test.cjs` "issue assigns the next number..." checks the settings case too.
- "the schedule PDF output is unchanged by the extraction": done in part 2 (#520);
  `schedule/pdf.parity.test.cjs` still passes, and `kit.test.cjs` holds the shared
  functions to the schedule module.
- The list with a status filter and search shipped in part 1.

## Decisions the owner may want to change

- A paid invoice can be voided by an operator and keeps its payment record. The spec's
  "reopen a paid invoice" (operator) is not built: no PR in the plan names a `reopen`
  action, and void plus duplicate covers corrections.
- Issue needs an issuer name in the settings and a due date that is not before the
  issue date. A payment date may be before the issue date (a prepayment), not after today.
- The prefix in the settings at issue time names the number; the sequence is one counter
  per deployment, so a prefix change continues the count (`SPONSOR-0042`).
- The PDF is US Letter with a standard font; non-Latin text is dropped or transliterated,
  as in the schedule PDF.
- The event package holds invoice drafts too; an invoice draft is a record, not an
  unpublished CMS edit.

## Left undone

- Emailing the PDF (part 4) and the Stripe pay link (part 5, #519).
- ADR 0001 §4.2 still says an operator "reopens a paid invoice"; see above.

## Checks (final run, after the last code edit)

lint clean; `npm test` 3601/3601; web 316 files, 3770/3770; `test:rules` 468/468;
`check-docs` passed; `build-pages --check` matched; `generate-content --demo --check`
matched; `build-demo --check` identical builds, within budget; `check:copy` clean;
`e2e/invoices.spec.js` 5/5.
