# apps/web

Vite 5 + React 18 + Tailwind 3 attendee-facing site, plus the sign-in flow.
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
| `pagesData.js` | pages-as-data (`/p/:slug`) |
| `scheduleData.js` | schedule days/sessions |
| `organizationsData.js` | speakers/sponsors |

Four providers then overlay live Firestore data on top of that snapshot,
outermost first:

```
EventConfigProvider          — subscribes to config/{event,features,theme,badges}
  AuthProvider                — Firebase Auth state + Google/OTP sign-in
    ProfileProvider           — subscribes to the signed-in user's own users/{uid}
      ContentProvider         — subscribes to published (or draft) CMS collections
        ToastProvider
          <Routes>             — Home, Schedule, Speakers, Sponsors, /p/:slug,
                                 /signin, /profile, /attendees, /attendees/:uid, 404
```

`EventConfigProvider` also writes a runtime `<style id="event-theme-runtime">`
that overrides the same custom properties `theme.css` defines, so a live
`config/theme` edit repaints without a rebuild (spec §7.2–7.5).

`ContentProvider` takes a `readSource` of `'published'` or `'draft'`.
`App.jsx` derives it from the `?preview=1` query param — convenience only;
`firestore.rules` is the actual control on who may read `*_drafts`.

Every subscription is fail-soft: a listener error is logged and the app
keeps rendering the last-known (snapshot or previously-live) values rather
than blanking the page.

`ProfileProvider` exposes `attendeeAccess`, which decides whether the
directory asks for `attendees_only` profiles or public ones only. That is a
query choice, not a permission: `firestore.rules` grant `attendees_only`
profiles solely to a requester whose own `users` doc shows approved,
speaker, or admin (spec §3.4), so a wrong guess costs a failed query, never
a leaked profile.

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

CI supplies dummy `VITE_FIREBASE_*` values so `npm run build -w apps/web`
stays credential-free (spec §8.1) — see the root `README`/CI workflow.

## Where `src/generated/` comes from

The files in `src/generated/` are a **committed synthetic snapshot** — a
fictional demo event (`demo-run-of-show`) — checked in so the app builds
and renders with zero external calls. At deploy time,
`scripts/generate-content.cjs` (functions-side, spec §8.6) regenerates the
same file shapes from the real client's Firestore data into `GENERATED_DIR`;
Vite reads from there instead when that env var is set. Never hand-edit the
committed snapshot to match a specific event — it must stay event-neutral
so a fresh clone (and CI) never leaks a real client's identity.

## Fonts (spec §7.4)

Three open-license variable font sets are self-hosted under
`public/fonts/` (`source-serif-4-latin.woff2`, `source-sans-3-latin.woff2`,
`caveat-latin.woff2` — all SIL OFL 1.1; see `public/fonts/README.md`). No
font CDN is ever requested at runtime — `theme.css` and the generated
`@font-face` rules point at these local files with system-stack fallbacks.

## Branding placeholders

`public/branding/` ships neutral, generic inline-SVG placeholder assets
(logo, mark, favicon, OG image) — not the Run of Show product identity.
Per-event branding overrides these once an event is seeded; until then the
shell stays event-neutral.

## Testing

```bash
npm run test -w apps/web   # vitest run — components, contexts, lib
npm run lint                # from repo root — hex-literal ban, hooks rules, this workspace included
npm run build -w apps/web   # production build; verifies dist/index.html + hashed assets
```

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
