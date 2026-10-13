# Epic #483 — admin ticketing bundle budget

## Failure and change

The director's final check built the application successfully, then failed the existing lazy-chunk budget. `AdminApp` measured 206,378 raw bytes and 57,764 gzip bytes. The limits are 180,000 and 50,000 bytes.

`apps/web/src/admin/pages/AdminTicketing.jsx` now loads `StripeTicketingWorkspace` through `React.lazy` when the selected provider is Stripe. A local `Suspense` boundary uses the existing `AdminLoadingState` with the label “Loading Stripe ticketing…”. The provider status and refresh control stay mounted while the workspace loads. The workspace and its organizer controls form a separate chunk. Legacy provider controls remain in their existing branch.

This preserves the application-level chunk error boundary and the workspace's own API error display. It does not change ticket operations, permissions, confirmation dialogs, or budget limits.

## Verification

Two rendered `AdminTicketing` cases cover loading the real Stripe workspace without moving focus from the provider refresh control, and displaying its catalog error while provider controls remain available. Existing workspace cases cover cancellation, refund allocation, complimentary tickets, check-in, catalog validation, and paginated lists.

Final checks after source and report edits:

- Focused Vitest: **24 tests passed across two files** (`AdminTicketing.test.jsx` and `StripeTicketingWorkspace.test.jsx`).
- ESLint for the two changed JavaScript files, with `--max-warnings 0`: **passed**.
- Copy-style check: **517 files checked; no blocked patterns**.
- Production build under the shared heavy-command lock: **passed**, using **Vite 5.4.21**, the version used by the director's failing check; 1,213 modules transformed.
- Bundle budget: **passed with no problems**. `AdminApp`: **165,940 raw / 47,178 gzip bytes**. Separate Stripe workspace: **41,037 raw / 11,698 gzip bytes**. Initial bundle: **1,035,697 raw / 280,052 gzip bytes**.
- `git diff --check`: **passed**.

The workspace also has a hoisted Vite 7 installation. An initial check passed with it, but the final measurements above use Vite 5 to match the application workspace and CI. The build retains Vite's general 500 kB advisory for the initial application chunk; the repository's explicit initial and lazy budgets pass.

The earlier director logs showed 3,085 server/shared tests, 3,332 web tests, and 368 rules tests passing before this fix. Those counts are evidence from the reviewed logs, not a new full-suite run for this commit. The director owns the integrated rerun, generated output, hosted browser checks, and pull request review. No generated output was committed, and the director's worktree was not changed.
