# Public bundle report

The report measures the entry module and each static JavaScript import required before route interaction. Dynamic route chunks are separate.

| Date | Build | Initial raw bytes | Initial gzip bytes | Initial chunks |
| --- | --- | ---: | ---: | ---: |
| 2026-08-24 | Normal | 1,001,709 | 266,428 | 1 |
| 2026-08-24 | Demo | 995,175 | 265,035 | 1 |
| 2026-09-09 | Normal | 986,933 | 264,368 | 1 |
| 2026-09-09 | Demo | 979,849 | 262,790 | 1 |

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

## Enforced limits

- The initial graph can use at most 1,020,000 raw bytes and 275,000 gzip bytes.
- Each deferred chunk can use at most 180,000 raw bytes and 50,000 gzip bytes.
- CI checks the normal build and the committed demo build.
