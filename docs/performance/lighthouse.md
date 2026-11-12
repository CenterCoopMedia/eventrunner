# Lighthouse lab checks

The Lighthouse workflow measures the static demo with mobile settings. It runs three times each on Home, Schedule and Speakers. Each metric uses its own median. Hash routes stay separate in the reports.

The workflow runs weekly on Monday at 09:17 UTC, on manual dispatch, and on pull requests and main pushes that change the listed public app or demo inputs. A change confined to `docs/` or `apps/web/src/admin/` does not start it. Superseded runs are cancelled. The workflow has read-only repository access and does not deploy.

## Run locally

Use Bash, Node 22.23.5 or a supported newer version, and system Chrome or Chromium. Keep its sandbox enabled. The block below was run on Debian with `/usr/bin/chromium`; on another system, use its installed browser path in the export below. No bundled browser is installed.

```bash
npm ci --ignore-scripts --prefer-offline
export CHROME_PATH=/usr/bin/chromium
export PUPPETEER_SKIP_DOWNLOAD=true
node scripts/build-demo.cjs --base / --out .lighthouse-site
npm exec --yes --ignore-scripts --package=@lhci/cli@0.16.1 -- lhci collect --config=scripts/ci/lighthouserc.cjs
node scripts/ci/lighthouse-report.cjs
npm exec --yes --ignore-scripts --package=@lhci/cli@0.16.1 -- lhci assert --config=scripts/ci/lighthouserc.cjs
```

The demo build and reports stay in ignored directories. LHCI starts and stops its temporary static server. It serves compressed assets and selects the local port. The report command requires three valid mobile reports for each configured route; a missing run, failed load, wrong route or missing metric fails the command.

The final assertion command currently exits 1 because the measured LCP exceeds 2500 ms. That result records the current performance gap. The separate workflow stays outside required CI until [#898](https://github.com/CenterCoopMedia/eventrunner/issues/898) is complete. It depends on [#625](https://github.com/CenterCoopMedia/eventrunner/issues/625). The existing required CI gate is unchanged.

## Limits and baseline

Median assertions are errors: LCP at most 2500 ms, CLS at most 0.1 and TBT at most 2000 ms. The initial TBT regression limit is the largest baseline route median, 1787.5 ms, rounded up to the next 250 ms. It is a regression limit, not a claim of good interaction performance. TBT does not replace field INP.

The [recorded baseline](lighthouse-baseline.json) contains all three values for every metric and route, the source commit, tool versions and entry checksum. It used LHCI 0.16.1, Lighthouse 13.6.0, sandboxed Chromium 156.0.8078.79, Node 22.23.5 and Debian 12 ARM64. Lighthouse used its simulated mobile throttling, including a 4x CPU multiplier. No artificial host load was generated.

| Route | Runs | Median LCP | Median TBT | Median CLS |
| --- | ---: | ---: | ---: | ---: |
| Home | 3 | 4441 ms | 927 ms | 0 |
| Schedule | 3 | 5362 ms | 1787 ms | 0.0768 |
| Speakers | 3 | 4511 ms | 567 ms | 0.0010 |

The focused collection took about 126 seconds, including the demo build. The build took 5.9 seconds; individual Lighthouse recorded totals were 7.7–8.8 seconds. Hosted runtime can differ. The workflow uses a 15-minute job limit and one browser stream.

## Read the reports

The job summary contains the median table. The `lighthouse-<run>-<attempt>` workflow artifact keeps all nine HTML/JSON reports, assertion results and the generated Markdown/JSON summaries for 14 days, including failed runs. There is no LHCI server, public upload target or third-party dashboard. Partial failed collections remain available as raw reports, while the summary command rejects an incomplete collection.

For a regression, open the artifact's HTML report and inspect the LCP element, network requests and long tasks. Compare the same route and mobile settings. Keep real failed results; do not regenerate a baseline or raise an assertion to hide a regression.

## What the demo measures

These are lab measurements of the committed public historical fixture. Firestore is offline in demo mode, so the run excludes live content reads and their latency. SDK parsing and initialization still cost time. The captured baseline also includes public Google authentication iframe/scripts; it is not a fully offline page. Bundled hero art excludes client image-manifest latency. The fixture does not represent a large live program, authenticated workflows or a venue network. These results do not supply field Core Web Vitals or field INP.

[LHCI configuration](https://github.com/GoogleChrome/lighthouse-ci/blob/v0.16.1/docs/configuration.md) defines the collection and median assertions. [Web Vitals](https://web.dev/articles/vitals) defines LCP and CLS thresholds. [TBT guidance](https://web.dev/articles/tbt) explains its role as a lab proxy for interaction work.
