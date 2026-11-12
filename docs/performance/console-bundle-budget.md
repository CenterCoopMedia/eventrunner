# Console bundle budget

The Console loads protected pages by route. The shell and sign-in stay in the
initial graph; setup, team and staff review pages load when reached. The budget
counts every static import of the entry, including a shared runtime, so moving
required code to another file does not hide its weight.

## Measurement

Measured before the route split on main `6a16023a`, and after integrating the
split/focus recovery on main `a0da35cf`, using Vite 8.3.4 and the existing checker
(gzip level 9). The integrated build also includes main's build-progress and setup-validation changes.
Public client
settings used fixed CI dummies; no credentials, backend or browser were needed.
Vite's printed gzip figure uses different compression settings, so the table
uses the checker consistently.

| Graph | Before raw bytes | Before gzip bytes | After raw bytes | After gzip bytes |
| --- | ---: | ---: | ---: | ---: |
| Initial JavaScript | 414,059 | 122,698 | 312,787 | 98,066 |
| Initial CSS | 25,217 | 5,492 | 23,721 | 5,300 |
| Largest deferred JavaScript | — | — | 17,758 | 5,592 |

The initial graph shrank 24.5% raw and 20.1% gzip. It contains the entry plus a
599-byte shared runtime. The largest deferred file is setup; staff review has
separate dynamic entries. The initial gzip graph is below the 114,040-byte goal.

From the repository root in a shell, reproduce the measurement with public
dummy client settings:

```sh
VITE_CONSOLE_FIREBASE_API_KEY=ci-dummy-api-key VITE_CONSOLE_FIREBASE_AUTH_DOMAIN=ci-dummy.firebaseapp.com VITE_CONSOLE_FIREBASE_PROJECT_ID=ci-dummy VITE_CONSOLE_FIREBASE_APP_ID=1:000000000000:web:0000000000000000000000 npm run build:console
node scripts/ci/bundle-budget.cjs --dist console/web/dist --json
node scripts/ci/bundle-budget.cjs --dist console/web/dist --budget scripts/ci/console-bundle-budget.json
```

## Limits

[The Console budget](../../scripts/ci/console-bundle-budget.json) is checked after
the normal Console build in hosted CI and the existing local build tier.

| Graph | Raw limit | Gzip limit |
| --- | ---: | ---: |
| Initial JavaScript | 325,000 | 103,000 |
| Initial CSS | 26,000 | 6,000 |
| Each deferred JavaScript chunk | 20,000 | 6,500 |

Initial JavaScript has about 4–5% headroom over the measured split; the largest
deferred chunk has about 13–16%. These limits prevent the review/setup code from
silently returning to first load or a deferred page growing without review.
Do not raise a limit without recording new measurements and their cause.

The unchanged checker was also run against a throwaway copy of the budget with
initial gzip set to 98,065. It exited 1 with `98066 > 98065`; the committed budget
passes the same build. No temporary limit is committed.

## Loading and recovery

Each stable page wrapper has its own Suspense boundary. A new page can show a
delayed loading state during a router transition, while setup retains its page
instance across step URLs. This follows [React's Suspense transition behavior](https://react.dev/reference/react/Suspense#preventing-already-revealed-content-from-hiding).
Imports that finish within 300 ms show no route fallback. Longer imports reuse
the existing loading state. Navigation focuses main while waiting, then the
destination heading if focus is still in main. A reader who moves to another
control keeps that focus.

A route error preserves the shell and offers an explicit page reload. The
reload requests the current deployment's entry and chunks; it does not retry
automatically or discard unsaved input without an action. Existing auth,
return-path and signup decisions are unchanged.

The hosted `console-routes` browser fixture builds the real route code with a
synthetic identity and API. It checks applicant/setup requests without staff
review chunks, a held setup import with heading focus, navigation away from a
missing Team chunk and a successful reload, and writes JSON network attachments.
The normal bundle
measurements above include the real Auth SDK and do not use that replacement.
