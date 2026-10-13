# Ticket operations integration report

## Scope

Organizer catalog and sales controls, scoped order/ticket queries, comp issuance,
attendee correction, explicit admission cancellation/refund allocation, online
check-in/undo, My tickets, and managed transactional confirmations for epic #483.
These endpoints build on the Stripe foundation PR and keep all client Firestore
access to commerce records denied.

## Decisions and fixes

- Staff can operate attendee records; catalog/commercial changes, comps, partial
  refund decisions, and check-in corrections require an operator.
- A cancellation changes admission, not money or sold capacity. Checked-in tickets
  require an operator for cancellation; claimed/used identities cannot transfer
  through the email correction form.
- Transactions include the durable historical-demo setting. An adversarial
  interleaving that enables demo mode before commit now prevents every mutation.
- Catalog edits preserve event/type held and sold capacity, currency, and revision.
  Invalid or foreign inventory fails closed.
- Concurrent scans write one check-in and one audit. Refunded/cancelled/unpaid
  admission and explicit registration revocation are rejected.
- Partial refund allocation requires a succeeded provider record and an explicit
  choice of ticket IDs or keeping admission for a price adjustment.
- Purchaser confirmation links use the actual `orderId` status query parameter;
  attendee invitations use the existing verified-email claim flow.
- Initial and explicit resend operations use the existing email send-once contract.
  Purchaser money details never enter another attendee's message, rendered bodies
  are not logged, and uncertain sends are recorded for review before another send.
- The shared HTTP boundary returns sanitized errors for configuration/database
  failures. The Firestore test fake gained normal `CollectionReference.add` parity
  for exercising the existing email log writer.

## Evidence and limits

Meaningful domain tests cover live roles, cross-account/event/mode reads, atomic
audit rollback, claim protection, duplicate scans, explicit revocation, used tickets,
demo-switch interleavings, catalog capacity/revision, idempotent comps, partial
refund allocation, filtered cursor progress, per-user ticket reads, and managed
email deduplication/recipient separation. Complete integrated Node checks, rules,
builds, source regeneration, hosted browser evidence, and final CI are recorded in
the PR stack after integration.

No production account, live payment, refund, or message to a real person was created.
Real Stripe sandbox rehearsal and organizer launch approval remain separate gates.
