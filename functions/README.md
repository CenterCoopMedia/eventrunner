# functions

Cloud Functions, one domain module per directory under `src/`. `index.js` is an export barrel only — no logic, no handler bodies (spec §1.3).

Landed so far (M2 backend foundation):

- `src/core/` — config loader/cache (`getEventConfig`, Tier A env accessors), CORS, error responses, lazy firebase-admin init
- `src/email/` — the one send path (bounded retry, `onceKey` send-once claims, `sent_emails` audit), template renderer with the `_html` escaping rules, phase-2 templates (`auth.otp`, `account.welcome`), Postmark/webhook/console adapters, delivery-event ingest (`emailDeliveryWebhook`)
- `src/auth/` — emailed-code sign-in: challenge store, rate bucket, attempt lockout, send-boundary code gate, custom-token issuance
- `src/notify/` — operator notifier with webhook/email/none sinks
- `src/cms/` — the two-revision publish model (spec §8.4): block-type registry, draft-only content/page/update editors, version history reads, and the chunked resumable publish pipeline over the six publishable collections and their `_drafts` siblings
- `src/admin/` — validated `config/*` writers (`updateEventConfig`, `updateFeatures`, `updateTheme`, `updateBadges`), the only path that writes config documents; rejects deploy-mirrored read-only fields and everything outside the `{event, features, theme, badges}` allowlist (spec §1.3). `access.cjs` holds the operator-only `listAdminAccess` and `setAdminAccess`, the only path that reads or changes `config/bootstrap` from the browser; it lowercases on write, refuses the change that would leave no operator, and records every change in `admin_logs` with the address and the tiers it moved between. `eventStats.cjs` holds the staff-tier `getEventStats`, the admin overview's figures: thirty Firestore `count()` aggregates over `users`, `tickets`, `speakers`, the publishable collections and their drafts, and `system_errors`, answered as integers with no document body read and no `admin_logs` row, plus the registration funnel summed from them.

## Admin tiers

Admin identity is the server-only `config/bootstrap` document, which carries two lists (issue #186):

| List | Tier | Runs |
|---|---|---|
| `adminEmails` | operator | Branding, feature flags, admin access, deployment settings, system errors. The list's name predates the split and is kept so every existing deployment keeps full access with no migration. |
| `staffEmails` | staff | Content, schedule, speakers, attendees, media, materials, feedback, live updates, ticketing operations. |

An address on either list is an admin. An address on both is an operator. Both lists are stored lowercase, because `firestore.rules` matches them against the lowercased token email.

**One gate, one option.** Every admin endpoint calls `requireAdmin(deps, req, { tier })` from `src/core/auth.cjs` and states its tier at that call, nowhere else:

```js
const gate = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);
// gate.tier is 'operator' or 'staff', for a handler that holds one field back.
```

`tier: 'staff'` admits both tiers. `tier: 'operator'` admits operators only. The option defaults to `'operator'`, so an endpoint that does not say refuses staff rather than admitting them. Pass `db` in the deps: with it the gate reads `config/bootstrap` live (`loadBootstrap`), so a grant or a revocation made on the Access page takes effect on the next request on every server. That path fails closed: a read that throws answers 500 (`BOOTSTRAP_UNAVAILABLE`) and admits nobody, and an absent document means no admins; the cached copy is never consulted. Only a caller that passes no `db` reads the five-minute config cache (`requireAttendeeAccess`, on purpose). A handler that needs the predicate without the HTTP verdict (an owner-or-admin check) calls `resolveAdminTier(await loadBootstrap({ db, getConfig }), email)`, which answers `'operator'`, `'staff'` or `null`; do not scan `adminEmails` by hand.

`firestore.rules` carries the same split as `isOperator()`, `isStaff()` and `isAdmin()`. Every admin-readable collection reads on `isAdmin()` except `admin_logs`, which is the operator's audit trail and the read the browser probes to learn its tier (`apps/web/src/contexts/AuthContext.jsx`).

**Classification.** Each endpoint's tier is the one its call site states:

| Tier | Endpoints |
|---|---|
| operator | `updateFeatures`, `updateTheme`, `listAdminAccess`, `setAdminAccess`, `listSystemErrors`, `resolveSystemErrors`, `webMcpInspectSystemErrors` |
| staff | `updateEventConfig` (a change to the `sender` block needs an operator; an unchanged sender goes through), `updateBadges`, every `cms*` endpoint, `mediaUpload`, `mediaDelete`, `mediaUpdateMetadata` (each refuses staff for anything that is branding: an upload into `branding/`, a branding asset, or an asset a `config/theme` slot references), `scanMediaUsage`, `createSpeaker`, `updateSpeaker`, `deleteSpeaker`, `applySpeakerPendingEdits`, `discardSpeakerPendingEdits`, `sendSpeakerInvite`, `resendSpeakerInvite`, `cancelSpeakerInvite`, `listSpeakerInvites`, `approveUser`, `revokeUser`, `removeUserCustomBadge`, `saveLiveUpdate`, `deleteLiveUpdate`, `updateFeedbackStatus`, the materials endpoints, `getTicketingStatus`, `ticketingSync`, `ticketingImportCsv`, `ticketingListTickets`, `createUserFromTicket`, and the other five `webMcp*` diagnostics |

Event settings admit staff because dates, venue, places, tracks, the register link and social handles are content an organizer runs day to day; the server compares a sent `sender` with the stored one inside the write transaction and refuses a staff CHANGE to it by name, because the outbound address is the identity `verify-sender-domain.cjs` attests (the form does not send the block for staff at all). Branding is the operator's wherever it is reached: the media endpoints gate at staff and then ask for the operator tier for an upload into `branding/`, a delete or relabel of a branding asset, and a delete of any asset a `config/theme` slot references, force or not. Ticketing provider setup (provider choice, API token, webhook registration) lives in Tier A env and operator scripts, so no admin endpoint carries it; the ticketing page is attendee operations.

**Adding an endpoint.** State the tier at the `requireAdmin` call, add a test beside the module that a staff caller is admitted or refused as intended, and, if the page reads a new collection directly, add it to `ADMIN_READABLE` in `tests/firestore.rules.test.js`. On the web side, the page's docket entry in `apps/web/src/admin/AdminLayout.jsx` declares the same tier.

The shared package is packed into `vendor/shared.tgz` by `npm run prepare:functions` (also the `firebase.json` predeploy hook), because Firebase uploads only this directory — a workspace symlink does not survive the upload. The tarball is gitignored; `package-lock.json` pins its integrity hash, so a stale tarball is a loud lockfile mismatch. See spec §1.1.

Tests live beside each module (`*.test.cjs`, `node --test`) and run with fakes — no emulator, no network. Modules take injected dependencies (`db`, `fetchImpl`, clocks); only `src/core/firestore.cjs` imports firebase-admin.
