# Public bundle report

The report measures the entry module and each static JavaScript import required before route interaction. Dynamic route chunks are separate.

## 2026-11-12: Firebase loads after the public snapshot (#625)

Hosted CI run [43343621985](https://github.com/CenterCoopMedia/eventrunner/actions/runs/43343621985) measured `367809f5` against the stack base `1110f947`. The normal Web build and demo build use the same budget script and gzip level 9. Each initial graph has three chunks.

| Build | Initial raw before | Initial raw after | Initial gzip before | Initial gzip after |
| --- | ---: | ---: | ---: | ---: |
| Normal | 958,565 | 412,245 | 288,934 | 129,479 |
| Demo | 963,643 | 416,582 | 290,064 | 130,440 |

The named SDK chunk includes its runtime wrapper and adds 548,017 raw / 160,309 gzip bytes in normal mode and 548,413 / 160,419 in demo mode. The initial-plus-SDK subtotal is 960,262 raw / 289,788 gzip bytes for normal mode and 964,995 / 290,859 for the demo. These subtotals include the automatic SDK load and exclude route-specific and optional feature chunks. The initial transfer falls by about 55%; the combined subtotal stays close to the parent initial graph.

Auth and Firestore, their Firebase App support, and their static dependencies move into that SDK chunk. Plain storage and function URL settings remain in the initial graph without importing an SDK. Storage stays on the profile workflow; App Check remains opt-in and dynamic. The existing snapshot/provider nesting, live overlays, authorization probes and listener retries remain.

The initial ceiling is 430,000 raw / 135,000 gzip bytes. The separately approved SDK ceiling is 560,000 / 165,000. Ordinary deferred chunks retain 180,000 / 50,000, and the CSS ceiling is unchanged. SDK bytes are included in the first-visit totals above even though they no longer block the snapshot render.

The existing mobile Lighthouse run [43343634399](https://github.com/CenterCoopMedia/eventrunner/actions/runs/43343634399) kept its three routes, three runs per route and simulated mobile settings. Compared with the same workflow at `1110f947`:

| Route | Median LCP before | Median LCP after | Median TBT before | Median TBT after | CLS after |
| --- | ---: | ---: | ---: | ---: | ---: |
| Home | 4511 ms | 3613 ms | 252 ms | 54.5 ms | 0 |
| Schedule | 5561 ms | 5009 ms | 688 ms | 296 ms | 0.0753 |
| Speakers | 4312 ms | 3239 ms | 109.5 ms | 37.5 ms | 0 |

All three LCP medians remain above the unchanged 2500 ms error limit. The remaining load work stays in #625 and #898; this change does not claim those issues complete. These static-demo results exclude live Firestore latency and do not supply a live-listener preview or field INP measurement.

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

That measurement included the router, React, and the Firestore and Auth clients
in the initial graph. The current snapshot shell does not need Firebase to paint;
its clients attach through the deferred runtime described above.
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

## 2026-11-04: the initial stylesheet joins the budget

The tool measured only JavaScript, so the blocking stylesheet could grow with no check. It holds every declared `@font-face`, `index.css` and `styles/schedule.css`.

| Build | Raw bytes | Gzip bytes |
| --- | --- | --- |
| Normal | 161,746 | 24,217 |
| Demo | 162,630 | 24,263 |

The first limit was 165,000 raw and 25,000 gzip bytes, the demo measurement plus a small margin. It records today's size. It does not say the size is good: reducing it needs its own measurement.

The NC Local style added about 5,400 raw bytes, which took the demo to 168,006 raw and 24,370 gzip. The limit is now 190,000 raw and 28,000 gzip bytes. The owner chose this room for design work, including loading animations, because the rest of the site is light.

## Enforced limits

- The initial graph can use at most 1,080,000 raw bytes and 292,000 gzip bytes.
- The stylesheets `index.html` names can use at most 190,000 raw bytes and 28,000 gzip bytes.
- Each deferred chunk can use at most 180,000 raw bytes and 50,000 gzip bytes.
- CI checks the normal build and a fresh demo build.
