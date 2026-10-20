# 39-invoice-email: email the invoice PDF (#208, part 4)

Branch `joe/blissful-einstein-9qvtd1-39-invoice-email`, from `origin/main` 767f2b9.
Part 4 of the five-part invoicing plan (spec: the 2026-10-20 comment on #208; owner
decision: the PDF goes as an attachment on the transactional stream).

## What changed

- **Shared** (`packages/shared/src/invoice.cjs`, `.mjs` shim): `validateInvoiceSend`
  (one optional copy address, checked as typed, not the billing email; an optional
  plain-text note up to `INVOICE_LIMITS.sendNote` = 1000). Lockfile hashes regenerated.
- **Email core** (`functions/src/email/send.cjs`): `cc` and `attachments`
  (`{ filename, contentType: application/pdf, content: base64 }`). A provider declares
  `capabilities: { attachments, cc }`; without it the message is refused before any
  claim or request (`attachments-unsupported`, `cc-unsupported`, `invalid-attachment`,
  `attachments-too-large`). `sendBatch` throws `EmailBatchError` with the same code.
  The `sent_emails` row keeps the copy and each file's name, type and size, never the
  content.
- **Providers**: Postmark maps `Cc` and `Attachments` and caps files at 7 MB (inside its
  10 MB message limit). Console writes them to `E2E_MAIL_FILE` (content included) and
  logs names only. The webhook relay declares no capability, so it is refused.
- **Template** `invoice.send` (registered; wording fixed in v1, no admin editor).
- **invoiceAdmin** `previewSend` (read action) and `send` (`functions/src/admin/invoiceEmail.cjs`).
  No new deployed function; `invoiceAdmin` now binds the provider's send secrets.
  `publicInvoice` carries `emailSends`; the event package exports them without `by`.
- **Editor**: `InvoiceEmailForm.jsx` in the invoice record (Email invoice, Copy to,
  Note, Preview email, Send to <billing email>, Send it again anyway), and an "Emails
  sent" list.
- **Docs**: ADMIN_GUIDE (Email the invoice), functions/README (Email), CHANGELOG,
  POSTMARK_PROVISIONING (§2 step 5, checklist), ROADMAP line.

## Decisions the owner may want to change

- The recipient is only the billing email on the invoice. One copy address is allowed,
  to any address; staff can already download the PDF, so this widens nothing.
- No display names in addresses (the billing contact name is in the greeting only).
- Replies go to the issuer email in the frozen issuer block, else the sender reply-to.
- The admin_logs row holds no address and no note (they are on the invoice and in the
  email log). A provider error text is not kept, only its status code.
- Resend window 15 minutes per address (recipient or copy), confirmable; at most five
  sends of one invoice per hour, not confirmable. A failed send does not count; an
  uncertain one does.
- A send does not bump the invoice revision.
- The webhook relay cannot send invoice email until it declares attachment support.

## Left undone

- The Stripe pay link (part 5, #519).

## Checks (final run, after the last code commit)

lint clean; `npm test` 3668/3668; web 316 files, 3787/3787; `test:rules` 471/471;
`check-docs` passed; `build-pages --check` matched; `generate-content --demo --check`
matched; `build-demo --check` identical builds, within budget; `check:copy` clean;
lockfile hashes stable after a fresh `prepare:functions`; `e2e/invoices.spec.js` 6/6 and
`e2e/data-export.spec.js` 2/2. Before the code, the new E2E test failed (no Email invoice
button) and the new unit and web tests failed (commit d01500c).

## Review round 1 (PR #535)

Tests first (68ac723), then the fixes:
- CodeQL "Incomplete URL substring sanitization" (3, test file): addresses are now
  extracted (`addressesIn`) and compared exactly. Local CodeQL finds the 3 alerts on the
  old file and 0 on the changed files.
- Settled stale send: its audit row names the original sender; the requester is
  `settledBy` (e4628e7).
- Mark paid, void and reopen refuse with 409 while a send is reserved and not stale
  (e4628e7). Commit 34d0dce imports the stale limit that e4628e7 exports; the tree is
  correct from e4628e7 on.
- Copy address: one shared predicate, `shared/email` `isBareEmailAddress`, used by
  `validateInvoiceSend`, the email core and the invoice email (34d0dce).
- The editor drops a preview answer that an edit overtook (b5f3971).

Checks after the fixes: lint clean; `npm test` 3671/3671; web 3788/3788; `test:rules`
471/471; check-docs, build-pages --check, generate-content --demo --check, build-demo
--check and check:copy clean; `e2e/invoices.spec.js` 6/6, `e2e/data-export.spec.js` 2/2.
