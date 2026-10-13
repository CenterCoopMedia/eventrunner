# Epic #483 — effective sales deadlines

## Scope and behavior

`apps/web/src/pages/Tickets.jsx` now displays the sales window that applies to each ticket type. The opening time is the latest configured event or type opening. The closing time is the earliest configured event or type cutoff. If only one scope supplies a boundary, that boundary appears. Missing boundaries stay hidden.

The page uses the existing `formatTicketTime` helper with the event timezone. The server still decides availability. This change does not alter checkout requests, payment state, URLs, route handling, or the page layout.

The change depends on the checkout agent's public catalog `salesStartAt` and `salesEndAt` fields, committed in `3cb40ad22fa8023e1dc0d754c438f3affe0ee1f3`. Those fields use the same normalized ISO UTC or null contract as each ticket type.

## Verification

Four rendered component cases in `apps/web/src/pages/Tickets.test.jsx` cover global-only deadlines, a tighter global window, a tighter ticket-type window, and ticket-type-only deadlines. Each checks the actual opening and closing text in a configured timezone offset from UTC. The global-only and tighter-global cases failed before the fix.

Final checks after source and report edits:

- Targeted Vitest: **23 tests passed in one file**.
- ESLint for the two changed JavaScript files, with `--max-warnings 0`: **passed**.
- Copy-style check: **517 files checked; no blocked patterns**.
- `git diff --check`: **passed**.

This focused display fix does not claim the epic's complete “Done when” condition. Integration, generated output, browser evidence, CI, and pull request review remain with the director. No generated files or external services were changed.
