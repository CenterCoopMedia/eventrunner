# Ticket confirmation keyboard focus repair

## Observed hosted failure

PR #486's initial head was `a10b5d36bbd8e8e6910b7c876dc9b7bfb852d44a`.
Its [E2E job](https://github.com/CenterCoopMedia/eventrunner/actions/runs/38332625604/job/115085650111)
finished with 76 tests: 75 passed, one failed, zero flaky and zero skipped.
These counts were verified in the downloaded Playwright report's `report.json`.
The two-test Stripe serial group retried once; the purchaser contract passed
both times, and the organizer confirmation contract failed both times.

The trace records three successful forward-Tab containment checks followed by
a failure on the fourth Tab, after the final Go back control. The screenshot
shows the confirmation dialog still open. The trace does not record the
literal outside `activeElement` target, so this report does not infer one.

## Repair

`TicketingConfirmation` still opens with native `showModal()`, initially focuses
its heading, handles native cancel events, and restores focus to its opener.
It now explicitly wraps Tab from its final available control to its first, and
Shift+Tab from the first control or initial heading to its last. It reads the
current controls on each keypress, including after a busy-state rerender, and
excludes hidden, disabled and negative-tabindex controls. Ordinary navigation
inside the dialog remains browser-managed.

The existing E2E containment assertion now exercises repeated Tab and Shift+Tab
and includes the active element's tag in any failure message. It still checks
Escape, focus restoration, cancellation wording and the submitted action. No
sandbox, retry or test-selection setting changed.

## Verification

- Before the repair, three new focused boundary regressions failed and the
  native modal/cancel/opener regression passed.
- After the repair, all 17 tests in `TicketingConfirmation.test.jsx` and the
  existing `StripeTicketingWorkspace.test.jsx` passed on Node 22.
- Scoped ESLint with `--max-warnings 0` and `git diff --check` passed.
- The strengthened hosted E2E has not yet run on this repair. The parent task
  will publish the integrated head and verify its new run before calling the
  UI PR ready.

## Original artifact evidence

The [admin visual artifact](https://github.com/CenterCoopMedia/eventrunner/actions/runs/38332625604/artifacts/11784255260)
contains 36 verified PNGs. Its ZIP is 4,599,044 bytes and has SHA-256
`f1a0af7c58bf54f42a79765770d99c0bda9c8f9887586913bb825beadcc9b136`.
The eight Stripe images are:

- `stripe-organizer-desktop.png`
- `stripe-organizer-mobile.png`
- `stripe-organizer-narrow.png`
- `stripe-purchase-desktop.png`
- `stripe-purchase-mobile.png`
- `stripe-purchase-narrow.png`
- `stripe-ticket-confirmation-mobile.png`
- `stripe-ticket-print.png`

`stripe-cancel-review-mobile.png` is absent because the original focus assertion
failed before that capture. These artifacts are evidence for the original
commit only and do not verify the repaired source.
