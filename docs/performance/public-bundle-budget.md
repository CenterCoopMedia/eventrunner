# Public bundle budget

The budget measures the JavaScript graph required to render the first public snapshot. The Firebase runtime starts after that paint and has a separate ceiling. The report gives both costs and their combined first-visit download.

The read-only static demo also renders Home, Program and Speakers to HTML at build time, using the same React components and snapshot data. Its document includes compact, standard and wide layouts; a short inline selector installs the requested route and viewport before entry modules execute. Matching routes hydrate those nodes. Different preview styles, filtered Program URLs and other routes use the live renderer. Client deployments retain their runtime render.

The generated head preloads the hero source and any responsive candidates the rendered image offers. Heading, body and data fonts remain preloaded with `font-display: swap`; the Speakers paragraph can paint from the HTML without waiting for its route module. Hosted browser checks block the entry module at phone, tablet and desktop widths, then verify that normal hydration preserves the painted main and hero nodes.

## Measurement

- Build the normal deployment and the static demo.
- Record the raw and gzip size of the entry chunk and its static imports, then the automatic after-paint Firebase chunk separately. Report their combined first-visit download too.
- Report the largest modules in the initial graph before and after a split.
- Exclude lazy route chunks from the initial total, but give each lazy chunk its own ceiling.
- Keep the measurement script deterministic and run it in CI after the web build.

The first committed limits must be below the measured pre-change initial graph. Later changes can reduce a limit. They must not raise a limit without a written reason and new measurements.

Run these checks after each build:

```sh
node scripts/ci/bundle-budget.cjs --dist apps/web/dist
node scripts/ci/bundle-budget.cjs --dist docs/demo
```

`node scripts/build-demo.cjs --check` runs the demo budget on its own scratch build, so CI needs no committed `docs/demo/`.

The committed limits are:

- 430,000 raw bytes and 135,000 gzip bytes for the initial graph.
- 190,000 raw bytes and 28,000 gzip bytes for the stylesheets `index.html` names, which block first paint.
- 180,000 raw bytes and 50,000 gzip bytes for each deferred chunk.
- 560,000 raw bytes and 165,000 gzip bytes for the named `firebase-sdk` chunk. This exception covers the static dependencies of the deferred Firebase runtime. Storage, Firestore Lite and dynamic App Check remain outside that group and retain the ordinary deferred ceiling.

### 2026-11-12: Firebase starts after snapshot paint (#625)

The public snapshot needs neither Auth nor Firestore to render. Those clients now attach after a painted frame, with no timer or idle delay. Signed-in routes and a stored sign-in hint start the load immediately. The hint grants no authority; the existing Firebase user, rules and server-confirmation checks still decide access.

The owner approved a separately named SDK ceiling in #625. Hosted CI run [43343621985](https://github.com/CenterCoopMedia/eventrunner/actions/runs/43343621985), at `367809f5`, measured the normal initial graph at 412,245 raw / 129,479 gzip bytes and the demo at 416,582 / 130,440. The SDK chunk, including its runtime wrapper, is 548,017 / 160,309 in normal mode and 548,413 / 160,419 in demo mode. The ceilings above leave about three percent of headroom. No other deferred ceiling or CSS ceiling changes.

This changes when visitors fetch the SDK, rather than removing it from the first visit. The [bundle report](public-bundle-report.md) includes the combined bytes. A source-graph contract pins every Firebase package and `firebase.js` out of the entry, Schedule and Speakers graphs. Hosted browser checks block the SDK request and require the snapshot to remain readable without an automatic reload.

### 2026-11-10: initial gzip limit 292,000 to 293,550 (#788)

The attendee feed (#788) reads only server-confirmed data and pages with a stable cursor. Both came from fixes in its independent review. The feed route is lazy, but the Firestore SDK is in the initial chunk, so the four new SDK exports count there: `getDocFromServer`, `getDocsFromServer`, `startAfter` and `endAt`. The server-confirmation flags in the shared auth, profile and event config contexts also load with the first page.

Measured with `node scripts/build-demo.cjs --check`:

| Build | Initial raw bytes | Initial gzip bytes |
| --- | ---: | ---: |
| Demo, `main` at `51062a24` | 975,052 | 291,921 |
| Demo, with #788 | 979,318 | 293,051 |

The four SDK exports add about 670 gzip bytes and the context changes about 460. Without the SDK exports, the demo is still over the old limit, and main had only 79 bytes left. The new gzip limit is the measured value plus about 500 bytes. The raw limit is unchanged.

See [the current bundle report](public-bundle-report.md) for measured results.

## Split rules

- Split at route or feature boundaries that a visitor can understand.
- Keep the existing admin boundary lazy.
- Move rarely used public workflows behind route-level imports when their providers and shared shell do not require them.
- Keep each lazy route inside the current chunk error boundary and an accessible loading state.
- Prefetch only after clear user intent, such as focus, hover, or navigation preparation. Do not download every route during the first paint.
- Do not duplicate Firebase or shared application state across chunks.
- Do not change caching or chunk names only to suppress Vite's warning.

## Route intent

The shell prepares a route's JavaScript and CSS after 100 ms of mouse hover, keyboard focus,
or a touch or pen press on an internal link. `src/routes.jsx` supplies both the router and the
intent matcher, including demo hash links. Route parameters and the CMS catch-all follow
React Router's path ranking. Downloads start only after intent, once per route module.
The route table stays in the entry bundle, so a direct link starts the matched page's import
without a separate registry download or an extra loading placeholder.
The optional intent handler loads on the first link interaction; a quick mouse sweep still
cancels the page download. Save-Data and 2G connections also skip that handler download.

Save-Data and slow-2g/2g connections skip prefetch. This prepares code only; page data,
images and fonts still load when the page renders. A failed prefetch stays silent and leaves
the tab's reload budget unchanged. Navigation can retry that import and retains the chunk
error boundary's recovery. A successful prefetch avoids the route loading placeholder.

## Acceptance

The public entry graph stays within its CI limit in both build modes. Direct navigation, client navigation, loading, chunk failure recovery, and demo hash routes continue to work.
