# Designed documentation generator implementation plan

**Tracks:** [Issue #108](https://github.com/CenterCoopMedia/eventrunner/issues/108), milestone M5.

## Decision

Use a small checked-in Node 22 generator. Markdown in the repository remains
authoritative; the generator writes only the presentation tree in `docs/docs/`.
GitHub Pages remains configured to publish `main:/docs`, and `.nojekyll`
remains in place. This avoids a second documentation source, a Jekyll toolchain,
or a hosted rendering dependency.

The generator uses the exact `marked@18.0.11` Markdown parser dependency. Its renderer
will escape raw HTML and reject unsafe URL schemes before emitting output. It will
not evaluate template-like text, so literal `{{...}}` and `${{...}}` remain
ordinary prose.

## Scope and ownership

At the time of the original plan, this work owned the documentation generator,
its tests, generated documentation output, and its maintenance instructions.
That pre-review boundary did not redesign `docs/index.html`, change `docs/demo`,
or alter source Markdown prose being updated by #97, #98, or #106. Existing
records under `docs/plans/` are historical and are excluded from the public
documentation navigation.

The generated pages use an editorial public-interest system: near-white paper,
navy text, a restrained blue accent, useful section boundaries, and the bundled
Source Sans 3 font file already served from `docs/demo/`. Headings and prose use
that sans-serif family; code uses the platform monospace stack. There will be no
cue numbering, status dots, pills, rounded-card decoration,
gradients, animations, fake email calls to action, small promotional copy, or
generic SaaS framing.

## Source manifest and stable routes

Each entry has one source path, title, audience section, and route. A route always
ends in `/` when published, and its corresponding output is `index.html`.

| Source | Route | Section |
| --- | --- | --- |
| `README.md` | `/eventrunner/docs/overview/` | Product |
| `docs/ROADMAP.md` | `/eventrunner/docs/roadmap/` | Product |
| `docs/interface-guidelines.md` | `/eventrunner/docs/interface-guidelines/` | Product |
| `docs/adr/0001-event-platform-v1.md` | `/eventrunner/docs/architecture/` | Product |
| `docs/ADMIN_GUIDE.md` | `/eventrunner/docs/admin-guide/` | Operators |
| `docs/CLIENT_ONBOARDING.md` | `/eventrunner/docs/client-onboarding/` | Operators |
| `docs/DEPLOY_RUNBOOK.md` | `/eventrunner/docs/deploy-runbook/` | Operators |
| `docs/POSTMARK_PROVISIONING.md` | `/eventrunner/docs/postmark-provisioning/` | Operators |
| `docs/handbook/README.md` | `/eventrunner/docs/handbook/` | Handbook |
| `docs/handbook/for-attendees.md` | `/eventrunner/docs/handbook/for-attendees/` | Handbook |
| `docs/handbook/for-clients.md` | `/eventrunner/docs/handbook/for-clients/` | Handbook |
| `docs/handbook/for-event-staff.md` | `/eventrunner/docs/handbook/for-event-staff/` | Handbook |
| `docs/handbook/getting-help.md` | `/eventrunner/docs/handbook/getting-help/` | Handbook |
| `docs/handbook/faq.md` | `/eventrunner/docs/handbook/faq/` | Handbook |
| `docs/handbook/glossary.md` | `/eventrunner/docs/handbook/glossary/` | Handbook |
| `CONTRIBUTING.md` | `/eventrunner/docs/contributing/` | Project |
| `CODE_OF_CONDUCT.md` | `/eventrunner/docs/code-of-conduct/` | Project |
| `GOVERNANCE.md` | `/eventrunner/docs/governance/` | Project |
| `SUPPORT.md` | `/eventrunner/docs/support/` | Project |
| `SECURITY.md` | `/eventrunner/docs/security/` | Project |
| `RELEASING.md` | `/eventrunner/docs/releasing/` | Project |
| `CHANGELOG.md` | `/eventrunner/docs/changelog/` | Project |

`/eventrunner/docs/` itself is a generated hub. The existing public landing page
at `/eventrunner/` remains the designed public equivalent of the repository
overview and will gain any landing-page navigation in #105.

## Generator contract

`scripts/build-pages.cjs` is the CommonJS command-line entry point and exports
the small testable generator functions. It supports two intentional modes:

- `node scripts/build-pages.cjs --write` renders the manifest and static shared
  assets to `docs/docs/`.
- `node scripts/build-pages.cjs --check` renders in memory and fails when tracked
  generated output differs from it or violates documentation invariants.

Each document page uses one semantic shell: skip link, site navigation, section
navigation, breadcrumbs, document `<main>`, in-page table of contents, and
previous/next document links. The generated hub uses the same shell and groups
plain document links by audience. The system uses stable GitHub-style heading
slugs, so both generated table-of-contents links and rewritten Markdown fragments
remain durable.

Links to a manifest source, relative Markdown links, and recognized GitHub blob
links will resolve to their presentation routes. Same-repository GitHub Pages
links using the obsolete `/run-of-show/` base will be normalized to
`/eventrunner/`. Unsafe `javascript:`, `data:`, and `vbscript:` URLs are not
emitted as links. Raw HTML is text, not executable markup.

Every output page includes a descriptive title, description, canonical URL,
Open Graph and Twitter metadata, theme color, an on-theme SVG favicon, and a
checked-in 1200 by 630 PNG social preview. The documentation asset bundle is self-contained under
`docs/docs/assets/`; its CSS uses the already checked-in, self-hosted Source
Sans 3 font without a font CDN request.

## Test-first implementation sequence

- [x] Add behavior tests for the manifest, route construction, shared shell,
  metadata, headings, safe rendering, fragment and blob rewriting, and literal
  template text. Run them red before implementing the generator.
- [x] Add validation tests for missing sources, duplicate or escaping routes,
  skipped headings, old Pages paths, raw migrated Markdown links, assets, and
  stale generated files. Run them red before the corresponding code.
- [x] Add the exact parser dependency, generator module, and command-line entry
  point in small red-green steps.
- [x] Generate the first output set with `--write` and verify it with `--check`.
- [x] Add the generator commands and a short maintenance section to the script
  documentation.
- [x] Run focused documentation tests, lint, generation freshness checks, the
  documentation checker, `git diff --check`, and source/output hygiene and
  browser reviews.
- [x] Run the full `npm test` suite as final verification. The isolated
  CI-equivalent run passed 1,519 of 1,519 tests under Ubuntu-equivalent UTC/LF
  conditions.
- [x] Review every changed line and request an independent local review.
- [x] Final pre-commit verification is complete. Do not push or open a pull
  request until #107 is merged.

## Acceptance checks

`--check` must reject a missing source; duplicate, invalid, or escaping route;
stale generated output; a legacy Pages `/run-of-show/` link; a source Markdown or
GitHub blob link that should have been migrated; skipped heading depth; missing
shared assets; and missing required page metadata. It must also prove that raw
HTML is escaped, only permitted URL schemes are rendered, and literal GitHub
Actions-style template expressions survive unchanged.

The generator is deliberately narrow. New public pages require one manifest entry
and a regenerated output tree; historical plans remain absent unless a future
issue explicitly promotes one.

## Post-review integration

After review, this branch integrated #98's Eventrunner source corrections and the
reader-entry Pages links needed for the generated documentation to be usable
outside the repository. Markdown remains authoritative; the generator continues
to own only `docs/docs/`.

- [x] Corrected the Eventrunner Postmark worked example and ordinary operational
  contact routes in the source documents.
- [x] Replaced reader-facing links to manifest documents with their public Pages
  routes, while retaining source-only legal, historical, and workflow destinations
  as explicit GitHub links.
- [x] Added manifest-aware entry-point and real-source rendering regression tests.
