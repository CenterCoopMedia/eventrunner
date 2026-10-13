# Epic #483 — attendee and organizer UI

## Scope and completion

Implemented the frontend slice of #483. The epic's complete “Done when” condition is not claimed by this branch alone: the server, shared routing, deployment readiness, generated demo output, hosted browser checks, and pull request review are being integrated by the director.

The attendee routes are `/tickets`, `/tickets/status`, and `/tickets/mine`. Selection requires a verified purchaser, named attendees with verified-claim email assignments, a complete displayed total, and refund-policy acceptance before hosted Stripe Checkout. Prices, account entitlements, and payment outcomes are never supplied by the browser. No card fields or live-payment simulations were added. Existing manual/Eventbrite/external registration and ticket-claim paths remain available.

The header and home registration controls share a credential-free public catalog lookup. A Stripe provider selects `/tickets`; other providers or an unavailable lookup retain the configured external registration action. Historical demos skip the lookup and disable purchase/organizer account actions. No new runtime registration-source flag was introduced.

Order recovery retains only purchaser-scoped request/order identifiers in session storage. Unknown outcomes retry the saved attempt, including after reload. An owner-scoped existing order returned by the server can be recovered from another device. A failed card attempt on a still-open order continues its existing Stripe session. Return URL flags never fulfill tickets. Purchaser responses are hidden immediately after an account change; recipient ticket pages show claimed admission records without purchaser financial details and support cursor pagination.

The print view includes an opaque human-readable ticket code, admission status, attendee name, and event identity. The code contains no encoded personal data. Assigned attendees explicitly claim through the existing verified-email flow; the confirmation link prefills the order reference without automatically claiming it.

Organizer ticketing now includes operator catalog setup, immutable saved currency, visible prices/capacity/windows/refund terms, pause/reopen review, cursor-based order and ticket filters, detail views, complimentary admission review, attendee correction, selected-ticket cancellation, online check-in, operator check-in correction, confirmation resend, reconciliation, refund-admission allocation, disputes, and audit history. Claimed or checked-in ticket emails cannot be edited in the UI. Money refunds remain in the account/mode-specific Stripe Dashboard handoff. Cancellation and refund allocation explain admission loss and the no-restocking rule at confirmation time.

## Files and decisions

- `apps/web/src/pages/Tickets.jsx`, `TicketStatus.jsx`, `MyTickets.jsx`, `TicketClaim.jsx`, `App.jsx`: attendee routes, verified ownership, stable retry/recovery, and claim navigation.
- `apps/web/src/lib/ticketingCommerce.js`, `useRegistrationLink.js`, `components/RegistrationAction.jsx`, `pages/Home.jsx`: authenticated no-store API calls, safe provider URLs, PII-free recovery markers, and one provider-selected registration destination.
- `apps/web/src/admin/components/Stripe*.jsx`, `TicketingConfirmation.jsx`, `admin/pages/AdminTicketing.jsx`: organizer workspace and native modal confirmations with focus restoration.
- `apps/web/src/components/TicketDocuments.jsx`, `index.css`: printable, readable admission records and viewport-constrained dialogs.
- `apps/web/src/components/AccountMenu.jsx`: captures the opener ref before effect cleanup, resolving the pre-existing lint warning requested by the director.

Last names are optional for people who use one name. UTC sales fields include event-timezone previews. Cancellations retain sold-capacity history. Hidden ticket types stay out of public selection. Public order confirmation and a claimed attendee's printable tickets are separate routes because purchaser financial ownership and attendee admission ownership are separate.

## Verification

Final source checks used Node 22 and the director's centrally installed dependencies; this worktree did not alter package manifests or generated output.

- Focused Vitest run: **134 passed across 10 files**. It includes 50 new tests covering API ownership/storage/URL safety, attendee selection and uncertainty recovery, declined-card and cross-device recovery, status privacy, recipient pagination, native/external CTA fallback, cancellation/refund/comp/check-in confirmation, stale responses/cursors, monetary precision, and catalog revision conflicts. Existing Home, RegistrationAction, AccountMenu, AdminTicketing, and TicketClaim tests passed in this run.
- Full frontend Vitest run: **3,319 passed, 1 failed across 284 files**. The only failure is `src/lib/siteNavigation.test.js`, which detects `/tickets` missing from this isolated branch's old shared `RESERVED_PATH_SEGMENTS`. The director owns the corresponding shared routing change. The test was not skipped or weakened; rerun it after integration.
- Repository ESLint with `--max-warnings 0`: **passed**, including the AccountMenu cleanup fix.
- Copy-style check: **517 files checked; no blocked patterns**.
- `git diff --check`: **passed**.
- Production Vite build: **passed**, 1,220 modules transformed in 6.26 seconds. Vite emitted its bundle-size advisory for the main application chunk (923.32 kB minified); the ticket purchase/status/recipient pages remain lazy route chunks.

The two new browser tests in `e2e/stripe-ticketing-ui.spec.js` use emulator sign-in plus synthetic HTTP contracts. They cover selection, a lost handoff and reload recovery, authoritative confirmation, printable tickets, viewport overflow at 1440/390/320 pixels, and native cancellation dialog keyboard containment/focus return. They write screenshots to `test-results/admin-visual-evidence`. They have not been executed locally: the container cannot launch Chromium with the required sandbox, and no sandbox bypass was used. Hosted CI must supply the browser result and reviewable screenshots.

Generated snapshots/demo output, rules/server tests, and a complete integrated CI run remain the director's integration work. There are no real Stripe credentials, card data, live charges, in-app money refunds, or external messages in this UI test work.
