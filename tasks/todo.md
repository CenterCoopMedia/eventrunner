# Session task list

Restyle the admin CMS on the njpbs-site editorial desk: its style, its type
pairing, and its hierarchy, expressed in this repo's own token system.
Branch `claude/admin-cms-design-language-ub69gr`, one PR against `main`.

## What changes and why

The composing-room admin sets everything on one warm grey at 11–14px, with
24px controls and a black filled button. The njpbs-site admin anchors the tool
with a dark navigation rail against a light canvas, a white title band, white
panels on the canvas, one action blue, tinted status badges, 44px controls, and
a 15px UI scale. This session ports that hierarchy. The admin still reads
`admin-*` tokens only, still obeys `data-mode` and ignores `data-theme`, still
uses Source Sans 3 and IBM Plex Mono, and still refuses shadows, pills, icons
in the rail, KPI tiles, eyebrows, and expressive motion.

## Foundation

- [x] `design/tokens/admin.json`: the editorial-desk palette in both modes,
      plus the rail, action, soft-ground, info-state, control-rule and
      rail-focus families, the admin type scale, control height, radii.
- [x] `node scripts/build-preset-catalog.cjs` regenerates the shared mirror.
- [x] `packages/shared/src/theme.cjs`: the accent floor is judged against the
      raised ground the header mark sits on; one client accent slot.
- [x] `apps/web/tailwind.config.js`: utilities for the new tokens and scale.
- [x] `apps/web/src/index.css`: the room's focus rings, the rail, the title band.
- [x] `node scripts/generate-content.cjs --demo` regenerates `theme.css`.
- [x] Tests updated: `themeModes.test.js`, `tokens.test.cjs`, `theme.test.cjs`.

## Chrome

- [x] `AdminLayout.jsx`: dark sticky rail, job-mark tile, grouped docket, account foot.
- [x] `adminChrome.jsx`: sticky title band, tinted state badge, empty state.
- [x] `formControls.jsx`: 44px controls, action-blue primary, white panels, notices.
- [x] `ModalShell.jsx`: panel radius and sizes.
- [x] Pinned tests updated: `AdminLayout.test.jsx`, `formControls.test.jsx`.

## Page sweep

- [x] Lists: pages, sessions, speakers, attendees, content, media, materials.
- [x] Editors: page, session, speaker, content block, venue reference.
- [x] Settings: event, features, badges, branding, ticketing, live updates,
      feedback, system errors.
- [x] Status words render as tinted badges everywhere a state renders.

## Admin colours (owner request, later in the session)

Joe asked whether a deployment could pick something other than blue and white
and chose both paths: follow the brand colour by default, with a picker for a
house scheme.

- [x] `design/tokens/admin.json`: six house seeds, light and dark.
- [x] `packages/shared/src/theme.cjs`: `deriveAdminScheme` and
      `resolveAdminScheme`; `adminScheme` in the document keys and the schema.
- [x] `scripts/lib/tokens.cjs` overlays the derivation at build time;
      `apps/web/src/lib/themeRuntime.js` writes it at runtime.
- [x] Branding: the **Admin colours** panel after **Light or dark**; the
      choice is written on every publish, brand included, so the snapshot
      overlay cannot hand a house scheme back.
- [x] Tests: `theme.test.cjs` (23 pairs per style, hostile brand and house
      scheme, both modes), `tokens.test.cjs`, `themeRuntime.test.js`,
      `schema.test.cjs`, `AdminBranding.test.jsx`.
- [x] Docs: the design record section, the brief, the admin story header,
      the interface guidelines, the design reference, the admin guide, CHANGELOG.
- [x] Evidence: the admin on the seeded event's own brand colour and on a
      house scheme, both modes.

## Verification

- [x] `npm run lint`, `npm run check:copy`, `npm test`, `npm run test:web`.
- [x] `node scripts/generate-content.cjs --demo --check`,
      `node scripts/build-preset-catalog.cjs --check`,
      `npm run build -w apps/web` and the bundle budget, `npm run build:demo`.
- [x] `npm run prepare:functions && rm -rf functions/node_modules/shared && npm install`.
- [x] Browser evidence from the emulators: light and dark, 1440 and 390, for
      the pages list, the page editor, sessions, speakers, attendees,
      branding, media, and ticketing. Saved under `docs/plans/evidence/`.
- [x] A "looks fine to software, feels wrong to humans" pass on the captures.
- [x] Docs: the design record, the admin story amendment, brief §0, the
      interface guidelines, the design reference, CHANGELOG; `docs/docs` regenerated.
- [ ] Review pass on the diff; findings fixed; checks re-run last.
- [ ] Commit with DCO sign-off as Joe, push, open the PR.

## Review

- Every diff gets a review pass before the PR opens.
- Checks run as the last step, after docs and generated output.
