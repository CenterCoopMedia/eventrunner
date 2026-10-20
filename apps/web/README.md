# apps/web

Vite + React 18 + Tailwind 3 attendee-facing site and organizer workspace.
Tracked under milestone M2 (pages-as-data, CMS, auth, schedule, theming) —
spec: [docs/adr/0001-event-platform-v1.md](../../docs/adr/0001-event-platform-v1.md).

## Two standing rules

- **No hardcoded event string or hex color.** Event identity comes from the
  generated snapshot / `config/event`; colors come from `config/theme`
  custom properties — the ESLint hex sweep (spec §7.6) enforces this with a
  three-path allowlist, one of which is the generated theme file itself.
- Every UI surface follows
  [docs/interface-guidelines.md](../../docs/interface-guidelines.md) — the
  foundational interface, accessibility, and writing rules for this repo.

## How the app reads its config (spec §2.4)

First paint never waits on a network round trip. It renders straight from
the committed **synthetic snapshot** in `src/generated/`:

| File | Feeds |
| --- | --- |
| `eventConfig.js` | event identity, dates, features, badges |
| `theme.css` | `:root` custom properties — brand/semantic colors as space-separated RGB triples, font stacks, radius, texture |
| `siteContent.js` | published CMS blocks/sections |
| `pagesData.js` | pages-as-data, routed at each page's own root-level `path` |
| `scheduleData.js` | schedule days/sessions |
| `organizationsData.js` | speakers/sponsors |
| `timelineData.js` | past editions for the home page's History section |

Four providers then overlay live Firestore data on top of that snapshot,
outermost first:

```
EventConfigProvider          — subscribes to config/{event,features,theme,badges}
  AuthProvider                — Firebase Auth state + Google/OTP sign-in
    ProfileProvider           — subscribes to the signed-in user's own users/{uid}
      ContentProvider         — subscribes to published (or draft) CMS collections
        ToastProvider
          <Routes>             — Home, Schedule (/schedule, /schedule/mine,
                                 /schedule/:sessionId), Speakers, Sponsors
                                 (/sponsors, /sponsors/:slug),
                                 /signin, /profile, /profile/organization
                                 (a representative's own organization),
                                 /attendees, /attendees/:uid,
                                 catch-all (cmsPages)
```

`EventConfigProvider` also writes a runtime `<style id="event-theme-runtime">`
that overrides the same custom properties `theme.css` defines, so a live
`config/theme` edit repaints without a rebuild (spec §7.2–7.5).

`ContentProvider` takes a `readSource` of `'published'` or `'draft'`.
`App.jsx` derives it from the `?preview=1` query param — convenience only;
`firestore.rules` is the actual control on who may read `*_drafts`.

Section edit links (issue #198) are convenience too.
`components/SectionEditLink.jsx` draws "Edit section" beside each section a
public page draws, and only while `AuthContext` reports `adminStatus` as
`'admin'`. The link opens `/admin/content/<page>/<section>`, where
`AdminGate`, the tier check in the admin shell, `requireAdmin` and
`firestore.rules` decide every read and write as before. The component
imports nothing under `src/admin`, so the public first paint carries one link
and no editor. `scripts/ci/bundle-budget.test.cjs` fails if the first-paint
source graph reaches a file under `src/admin`.

Every subscription is fail-soft: a listener error is logged and the app
keeps rendering the last-known (snapshot or previously-live) values rather
than blanking the page.

`ProfileProvider` exposes `attendeeAccess`, which decides whether the
directory asks for `attendees_only` profiles or public ones only. That is a
query choice, not a permission: `firestore.rules` grant `attendees_only`
profiles solely to a requester whose own `users` doc shows approved,
speaker, or admin (spec §3.4), so a wrong guess costs a failed query, never
a leaked profile.

`AuthProvider` exposes `adminStatus` and `adminTier` (issue #186). Both come
from rules probes, not from a readable allowlist: a `cmsContent_drafts`
read that succeeds means admin, and an `admin_logs` read that succeeds
means operator rather than staff. The admin shell reads the tier in one
place: every entry in `DOCKET` (`src/admin/AdminLayout.jsx`) declares the
tier it needs, the rail draws only the sections the signed-in tier may
reach, and the layout refuses the route of any other (the segment is
percent-decoded and lowercased first, the way the router matches it, and a
path no staff section owns is the operator's). A new admin page declares
its tier by its docket entry and nowhere else, and `TIER_SCOPE` names each
tier's sections from the docket for every sentence that describes a tier;
the server's `requireAdmin` tier option and the rules are the enforcement.

## Dev loop

```bash
# 1. From the repo root, start the emulators this app talks to.
EVENT_FIREBASE_PROJECT_ID=demo-run-of-show \
EVENT_EMAIL_PROVIDER=console \
EVENT_ALLOWED_ORIGINS=http://127.0.0.1:5173 \
FUNCTIONS_EMULATOR=true \
npx firebase emulators:start --only functions,firestore,auth --project demo-run-of-show

# 2. In another shell, run Vite against them.
cd apps/web
VITE_FIREBASE_API_KEY=demo \
VITE_FIREBASE_AUTH_DOMAIN=demo-run-of-show.firebaseapp.com \
VITE_FIREBASE_PROJECT_ID=demo-run-of-show \
VITE_FIREBASE_STORAGE_BUCKET=demo-run-of-show.appspot.com \
VITE_FIREBASE_MESSAGING_SENDER_ID=000000000000 \
VITE_FIREBASE_APP_ID=1:000000000000:web:0000000000000000000000 \
VITE_USE_EMULATORS=true \
VITE_FUNCTIONS_ORIGIN=http://127.0.0.1:5001/demo-run-of-show/us-central1 \
npx vite
```

`src/firebase.js` connects to the Auth/Firestore/Storage emulators only when
`import.meta.env.DEV && VITE_USE_EMULATORS === 'true'` — a production build
never does this by accident. The Functions emulator has no separate SDK
connection step; `VITE_FUNCTIONS_ORIGIN` points the OTP fetch calls
(`src/contexts/AuthContext.jsx`) straight at it.

With `EVENT_EMAIL_PROVIDER=console` (the default under
`FUNCTIONS_EMULATOR=true`), sign-in codes are never actually emailed — the
functions emulator logs the rendered message to its own stdout
(`[email:console] {...}`) instead. `scripts/dev/login-smoke.mjs` reads that
log to drive the sign-in flow end to end without any real inbox; see below.

### Env vars this app reads

| Var | Purpose |
| --- | --- |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` | Firebase client config (non-secret; required to build) |
| `VITE_FIREBASE_REGION` | Functions region for the OTP endpoint URLs (default `us-central1`) |
| `VITE_FUNCTIONS_ORIGIN` | Overrides the whole functions origin — point it at the Functions emulator in dev |
| `VITE_USE_EMULATORS` | `'true'` connects Auth/Firestore/Storage to local emulators (dev only) |
| `GENERATED_DIR` | Points the `@generated` alias at an out-of-tree deploy-time snapshot instead of the committed `src/generated` (spec §8.6) |
| `VITE_DEMO_MODE` | `'1'` builds the static, read-only GitHub Pages demo (see "Demo mode" below). Never set by a client build. |

CI supplies dummy `VITE_FIREBASE_*` values so `npm run build -w apps/web`
stays credential-free (spec §8.1) — see the root `README`/CI workflow.

## Where `src/generated/` comes from

The files in `src/generated/` are a **committed public demo snapshot** — an
explicitly approved historical NC Local mock-up (`demo-run-of-show`) — checked in so the app builds
and renders with zero external calls. At deploy time,
`scripts/generate-content.cjs` (functions-side, spec §8.6) regenerates the
same file shapes from the real client's Firestore data into `GENERATED_DIR`;
Vite reads from there instead when that env var is set. Never hand-edit the
committed snapshot from a client deployment. The public historical demo is
curated in `scripts/lib/demo-event.cjs`; no private client data belongs here.

## Demo mode (`VITE_DEMO_MODE=1`)

`node scripts/build-demo.cjs` (`npm run build:demo`) produces the public
click-through demo in `docs/demo/` (build output, not committed), which
`.github/workflows/pages.yml` builds and serves from GitHub Pages
at `/eventrunner/demo/`. It is this same app with one env var set, read in
exactly one place — `src/lib/demoMode.js` — and consumed at five points:

| Where | In demo mode |
| --- | --- |
| `src/main.jsx` | `HashRouter` instead of `BrowserRouter` |
| `src/firebase.js` | `disableNetwork(db)` before any listener attaches; App Check never initialized |
| `src/lib/contentSource.js` | the CMS/speaker subscriptions are not attached at all |
| `src/lib/mediaSource.js` | `assetUrl()` resolves bundled `branding/*` placeholders, everything else is absent |
| `src/components/SignInPanel.jsx`, `src/pages/Login.jsx`, `src/components/DemoBanner.jsx` | sign-in replaced with a "disabled in this demo" notice; standing demo banner |
| `src/App.jsx` | the `/specimen` route is registered (see below) |

Two of those are worth the detail:

- **Why not `basename` + a `404.html` SPA shim.** GitHub Pages serves only
  the SITE-root `404.html`, and this repo's site root is `docs/` — the
  project's documentation site. A shim there would hijack 404 handling for
  every unrelated docs page. HashRouter keeps deep links inside the fragment
  and needs no server behaviour at all.
- **Why the content overlay is skipped rather than left to fail.** With the
  Firestore client offline, a collection query is answered from an empty
  local cache — a *successful, empty* result, which `ContentProvider`
  documents as replacing the snapshot wholesale. Not subscribing leaves each
  overlay slot `null`, which is the "no runtime result yet" state that keeps
  the committed snapshot in charge.

Nothing else changes. A client build never sets `VITE_DEMO_MODE`, so every
branch above folds to a constant and drops out of the bundle — the
`deploy-client.yml` / `scripts/publish-site.cjs` pipeline is untouched.

## The specimen book (`/specimen`)

`src/pages/specimen/` renders every device in the system, in the style and
mode the page is set to, with the component file and the tier 3 contract
beside each one. Use it to review a change across all six styles without
opening six pages.

- **The gate.** `SPECIMEN_ENABLED` in `src/pages/specimen/specimenRoute.js` is
  the demo switch or `import.meta.env.DEV`, and `loadSpecimenPage` beside it
  holds the page's dynamic import. The gate is an expression over build
  constants, not a function call, and it reads `import.meta.env` in the same
  module as the `import()`. Rolldown (Vite 8) folds only a condition it reads
  in that module. With the condition imported from `lib/demoMode.js`, it
  wrote the lazy chunk into a client production build even though no route
  pointed at it. `specimenRouteEnabled()` is the same rule as a pure
  function, for tests.
- **Reaching it.** `npm run dev` then `/specimen`. In the demo build the
  router is a hash router, so it is `#/specimen`, and the demo banner's
  `?style=` and `?mode=` values apply to it like any other page.
- **Staying out of the index.** The page adds a `robots` `noindex` tag while
  it is mounted and removes it when it unmounts, and
  `scripts/write-site-files.cjs` refuses a sitemap that lists the route.
- **Keeping it complete.** `src/pages/specimen/tokens.js` lists the scales
  the book draws; `tokens.test.js` pins every list to
  `design/tokens/semantic.json`, including the two page widths, the three
  interaction-state shares and the two values the focus ring is drawn from.
  `Specimen.test.jsx` renders the page and checks that every component under
  `src/components/editorial/` and `src/components/forms/` appears in it.
- **Adding a control.** One file per control in
  `src/pages/specimen/controls/`, then one import and one line in that
  directory's `index.js`. The file declares the states it draws and the
  states it does not have, with the reason for each; `controls/index.test.js`
  fails a control that accounts for neither, because a state that is missing
  looks the same as a state somebody decided against.
- **The folio is the position in the contents.** `sections/index.js` is the
  order, and each section takes its number from its place in that array, so
  inserting a section renumbers the book on its own.

## Fonts (spec §7.4)

Three open-license variable font sets are self-hosted under
`public/fonts/` (`source-serif-4-latin.woff2`, `source-sans-3-latin.woff2`,
`caveat-latin.woff2` — all SIL OFL 1.1; see `public/fonts/README.md`). No
font CDN is ever requested at runtime — `theme.css` and the generated
`@font-face` rules point at these local files with system-stack fallbacks.

## Branding placeholders

`public/branding/` ships neutral, generic inline-SVG placeholder assets
(logo, mark, favicon, OG image) — not the Event Runner product identity.
Per-event branding overrides these once an event is seeded; until then the
shell stays event-neutral.

Two raster placeholders sit beside them: `app-icon-192.png` and
`app-icon-512.png`, the app icons `public/manifest.webmanifest` lists. They
are drawn from the default mark's numbers, not converted from the SVG. The
publish and deploy scripts replace them with an uploaded square PNG icon
when there is one (`scripts/lib/app-icons.cjs`).

After a change to `mark.svg`, a unit test fails until you do these steps in
order:

1. Update `PLACEHOLDER_MARK` in `scripts/lib/app-icons.cjs` to match the new
   `mark.svg`. If the shapes change, update `renderPlaceholderIcon` too.
2. Run `node scripts/dev/build-app-icons.mjs`.
3. Commit both PNGs with the change.

## Native Stripe ticketing (#483)

The lazy routes `/tickets`, `/tickets/status`, and `/tickets/mine` add attendee selection,
authoritative purchaser confirmation, and claimed-attendee print views. `TicketClaim`
accepts an `?order=` prefill through the normal verified-email claim flow; a query parameter
never claims a ticket automatically. The purchase page uses public catalog data, then a
verified purchaser token for checkout/status. The recipient page reads only that account's
claimed tickets through its private API, with cursor pagination.

The shared `useRegistrationLink` hook makes one credential-free provider lookup for the
home and header registration actions. Stripe selects the internal `/tickets` destination.
Confirmed Eventbrite, manual, and none providers preserve the configured external action.
If provider lookup fails, the native ticket page shows its error and retry control; an
outage never selects a possibly stale external checkout source. Historical
and static demos skip the lookup. The rest of the shell still renders from its snapshot;
commerce availability and financial state require current server responses.

`ticketingCommerce.js` sends App Check and bearer credentials where appropriate, requests
private responses with `no-store`, restricts payment handoffs to hosted Stripe Checkout,
and stores only account-scoped request/order identifiers for recovery. The browser never
submits a price, currency, Stripe Price ID, entitlement, or claimed user ID as purchase
authority. Unknown responses retry a saved attempt; owner-scoped order recovery also works
from another device. A declined card on an open Session is recoverable. Return URL flags
never fulfill tickets, and switching accounts immediately hides the previous purchaser's
private response. Only confirmed paid/free orders represent completed purchase fulfillment.

`AdminTicketing` keeps the other providers' workspace and mounts `StripeTicketingWorkspace`
for Stripe. Its catalog, order/ticket lists, corrections, comp/cancel, check-in, refund
allocation, resend, reconciliation, and audit controls call server-gated APIs. Sensitive
actions use native modal review with affected records, reasons, and admission consequences.
Money refunds stay in the organizer's Stripe Dashboard; the UI never collects card data.
Opaque text codes provide an accessible printable fallback without encoding personal data.
Public and admin surfaces use their respective design tokens.

The unit files `Tickets.test.jsx`, `TicketStatus.test.jsx`,
`StripeTicketingWorkspace.test.jsx`, `RegistrationActionStripe.test.jsx`, and
`ticketingCommerce.test.js` cover ownership, identity assignment, retry/reload and cross-device
recovery, financial/admission state, precision, review, role visibility, pagination, and
provider fallbacks. `e2e/stripe-ticketing-ui.spec.js` uses emulator sign-in and synthetic HTTP
responses for purchase/status/print, cancellation focus containment/restoration, and
1440/390/320px screenshots in `test-results/admin-visual-evidence`. It does not call Stripe.

See [ADR 0004](../../docs/adr/0004-stripe-ticket-commerce.md) and the
[Stripe launch/support runbook](../../docs/operator/stripe-ticketing.md) for merchant
ownership, required secrets, test/live readiness, retention, and the separately authorized
real Stripe rehearsal. Embedded payment UI remains in
[#325](https://github.com/CenterCoopMedia/eventrunner/issues/325); limited-access pass
entitlements remain in [#326](https://github.com/CenterCoopMedia/eventrunner/issues/326).

## Testing

```bash
npm run test -w apps/web   # vitest run — components, contexts, lib
npm run lint                # from repo root — hex-literal ban, hooks rules, this workspace included
npm run build -w apps/web   # production build; verifies dist/index.html + hashed assets
```

The toolchain is Vite 8 (Rolldown bundler), `@vitejs/plugin-react` 6 and
Vitest 5. Vitest 5 needs Node 22.12 or later. `vite.config.js` puts the
static import graph of `src/main.jsx` in one `initial` chunk. Without that
group, Rolldown splits it into about 40 small files, and the first paint
costs about 8 kB more gzip than the budget in
`scripts/ci/bundle-budget.json` can absorb over time.

### Live smoke test (sign-in flow)

`scripts/dev/login-smoke.mjs` drives the real Login page with Playwright
against the dev loop above: enters an email, submits, scrapes the six-digit
code out of the functions-emulator console log, enters it, and asserts the
app reaches signed-in state. It is a dev tool (credential-free, demo
project only) — not part of `npm test`.

```bash
node scripts/dev/login-smoke.mjs \
  --app-url http://127.0.0.1:5173/signin \
  --emulator-log /path/to/captured-emulator-stdout.log
```

Requires the `playwright` package and a Chromium binary
(`PLAYWRIGHT_BROWSERS_PATH`); it never runs `playwright install` itself —
if the browser isn't present it fails fast with a clear message instead of
attempting a network fetch.

### Full e2e suite

`node scripts/dev/login-smoke.mjs` above covers OTP sign-in on its own; the
repo-root [`e2e/`](../../e2e/) Playwright suite (`npm run test:e2e`, spec
§8.1, issue #38) covers that plus the other three critical journeys — admin
CMS edit → publish → public → version history, speaker invite → accept → wizard, ticket claim
→ approved → bookmark — the updates editor (issues #190 and #191: an
update written and saved as a draft in the admin stays off the public Updates
page until the editor publishes it, and then leads the page as the featured
update with its category tag), and the timeline journey (`e2e/cms-timeline.spec.js`:
an entry published from the admin editor appears on an open home page with
no reload, and with every listener held the first render of the home page
already lists the snapshot editions) against the same emulator/dev-server combination,
seeded from `scripts/init-event.cjs` + `scripts/seed-demo-event.cjs`. See
[`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) for the full test command
table.
