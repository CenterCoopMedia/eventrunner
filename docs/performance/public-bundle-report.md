# Public bundle report

The report measures the entry module and each static JavaScript import required before route interaction. Dynamic route chunks are separate.

| Date | Build | Initial raw bytes | Initial gzip bytes | Initial chunks |
| --- | --- | ---: | ---: | ---: |
| 2026-08-24 | Normal | 1,001,709 | 266,428 | 1 |
| 2026-08-24 | Demo | 995,175 | 265,035 | 1 |
| 2026-09-09 | Normal | 986,933 | 264,368 | 1 |
| 2026-09-09 | Demo | 979,849 | 262,790 | 1 |
| 2026-09-13 | Normal | 1,039,908 | 279,231 | 1 |
| 2026-09-13 | Demo | 1,044,095 | 281,409 | 1 |

The parent demo build used 1,083,709 raw bytes and 286,942 gzip bytes before the route split. The split removes 88,534 raw bytes and 21,907 gzip bytes from that initial graph.

## 2026-09-09: the Storage SDK leaves the first paint

Navigation from page documents, the sitemap, the countdown, and two seeded
pages had grown the initial graph past its raw limit — 1,021,705 raw bytes
against 1,020,000, with three more changes still to land on top. No limit was
raised. The graph was measured instead, and the largest thing in it that a
first paint does not use was moved behind the route that does use it.

The fifteen largest modules in the entry chunk before the split, in minified
bytes attributed through the build's own source map:

| Module | Minified bytes |
| --- | ---: |
| `@firebase/firestore` `common-*.esm.js` | 302,089 |
| `re2js` (a Firestore dependency) | 144,595 |
| `react-dom` | 129,732 |
| `@firebase/auth` | 114,679 |
| `@firebase/webchannel-wrapper` webchannel blob | 40,102 |
| `@firebase/storage` | 34,434 |
| `@firebase/util` | 18,058 |
| `@firebase/app` | 16,342 |
| `@firebase/firestore` `index.esm.js` | 14,840 |
| `shared/presetCatalog.cjs` | 14,774 |
| `src/generated/siteContent.js` | 13,559 |
| `@firebase/webchannel-wrapper` bloom blob | 11,211 |
| `src/generated/pagesData.js` | 11,203 |
| `@remix-run/router` | 10,133 |
| `react-router` | 9,589 |

Everything above `@firebase/storage` is either the router, React itself, or
the Firestore and Auth clients that the shell subscribes to on first paint.
`@firebase/storage` was not: no page reads media through the Storage service.
`lib/mediaSource.js` builds object URLs as strings from the bucket name, and
the only calls that need the SDK are one attendee uploading or removing their
own photo on `/profile`. `components/Layout.jsx` imports `brandingSrc` from
that module for the site logo, so the SDK rode into the entry chunk behind a
string helper.

Those two calls now live in `apps/web/src/lib/photoUpload.js`, which only the
already-lazy `/profile` route imports, and `firebase.js` no longer creates a
Storage client. The `/profile` chunk grows from 9,102 to 43,959 raw bytes,
well inside the 180,000-byte deferred ceiling, and the first paint loads the
SDK for nobody who does not open the photo field.

| Build | Initial raw before | after | Δ raw | Initial gzip before | after | Δ gzip |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Normal | 1,021,705 | 986,933 | −34,772 | 272,232 | 264,368 | −7,864 |
| Demo | 1,014,567 | 979,849 | −34,718 | 270,605 | 262,790 | −7,815 |

`scripts/ci/bundle-budget.test.cjs` walks the static import graph from
`apps/web/src/main.jsx` and fails if `firebase/storage` — or
`lib/photoUpload.js` — is reachable from it again, so the next import of a
string helper from the wrong module is caught in source rather than as an
unexplained kilobyte count.

The largest deferred chunk is the admin application. It uses 177,110 raw bytes and 49,359 gzip bytes in the demo build.

## 2026-09-13: full event content

The demo now includes 12 speaker profiles, six sponsors, 32 schedule entries,
and 100 content blocks. The generated snapshot renders on first paint in both
build modes. Its expansion adds 23,264 minified bytes before the demo-only
announcements. No SDK dependency was added.

The initial limit is now 1,080,000 raw bytes and 292,000 gzip bytes. This allows
the requested event content and retains a small margin above both measured
builds. Deferred chunk limits stay unchanged. The 20 portrait, logo, and scene
images use 1.54 MB of WebP files outside the JavaScript graph.

## 2026-09-13: session detail and rich updates

Full session descriptions, six sponsor biographies, and six rich update examples
add 24,829 raw bytes and 7,778 gzip bytes to the demo entry graph. Sponsor detail and update rendering remain in deferred route chunks. The
Leaflet map library loads only when the map enters the viewport.

| Build | Initial raw bytes | Initial gzip bytes | Initial chunks |
| --- | ---: | ---: | ---: |
| Normal | 1,058,761 | 285,182 | 1 |
| Demo | 1,068,924 | 289,187 | 1 |

The initial ceiling is 1,080,000 raw bytes and 292,000 gzip bytes to include this
requested sample content with a small margin. Deferred limits remain unchanged.

## 2026-09-24: section edit links and the editor tour

Issue #198 adds one "Edit section" link per drawn section for a signed-in
admin. The link component and its call sites join the initial graph; it
imports nothing under `src/admin`, and `scripts/ci/bundle-budget.test.cjs`
fails if the first-paint source graph reaches a file there. The editor tour
is its own deferred chunk, fetched only while the tour is open, so the admin
entry chunk carries only the stored flag, the rail button, and the line that
stands in when the tour chunk fails to load.

| Chunk | Before raw | Before gzip | After raw | After gzip |
| --- | ---: | ---: | ---: | ---: |
| Initial, normal build | 1,059,326 | 286,743 | 1,060,189 | 286,957 |
| Initial, demo build | 1,069,780 | 290,736 | 1,070,643 | 291,004 |
| Admin entry (`AdminApp`), normal build | 129,796 | 35,612 | 130,867 | 36,013 |
| Admin entry (`AdminApp`), demo build | 129,796 | 35,622 | 130,867 | 36,009 |
| Content page (deferred), normal build | 11,711 | 4,837 | 11,862 | 4,879 |
| Editor tour (deferred, new), normal build | none | none | 2,667 | 1,334 |

The link component itself is 444 raw and about 125 gzip bytes of the
initial growth; the rest is the call sites. Loading the component on demand
would save about 35 gzip bytes and add a request and a Suspense boundary for
every link, so it stays in the initial graph. No limit changed.

## Enforced limits

- The initial graph can use at most 1,080,000 raw bytes and 292,000 gzip bytes.
- Each deferred chunk can use at most 180,000 raw bytes and 50,000 gzip bytes.
- CI checks the normal build and the committed demo build.
