# Issue 316 mobile layout evidence

This evidence covers the Issue 316 rendering changes through source commit
`ecdfa10feec0c695cfb60820262c1d7b784e41ae`. The normal 480-cell public matrix
was captured at `8ee16eec6784cc1f951eeffa7a3f7fa795a15fa2`. The later source delta changes
the shared admin shell, Branding preview and whole-document serialization,
tests, documentation and generated demo. The public stress, illustrated,
reduced-motion and all CMS preview cells were rerun at `ecdfa10f`. The full
admin matrix and every admin destination were also run at `ecdfa10f`. The
evidence files are the only changes after that source commit.

The run used the project's Chromium Playwright project and synthetic Firebase
emulators. It did not read or write a live event. The matrix uses real browser
viewport widths. The 320 CSS px cells also cover the reflow width produced by
a 640 CSS px viewport at 200% zoom.

## Matrix result

| Surface | Coverage | Result |
| --- | --- | --- |
| Public Home and Schedule | 6 themes x 2 modes x 14 widths x 2 routes = 336 cells | Pass |
| Public route coverage | 6 themes x 2 modes x 2 widths x 6 routes = 144 cells | Pass |
| Long-copy stress | 6 themes x 2 modes x Home/Schedule = 24 cells | Pass |
| Illustrated hero | 6 themes x 2 modes at 390px = 12 cells | Pass |
| Reduced motion | 6 themes x 2 modes at 390px = 12 cells | Pass |
| Populated admin Branding form | 2 modes x 16 widths = 32 cells | Pass |
| Shared admin shell | 25 destinations x 2 modes at 412px = 50 cells | Pass |
| Open admin drawer | 2 modes at 412px = 2 cells | Pass |
| CMS phone preview | 6 themes x 2 modes at a real 390px iframe viewport = 12 cells | Pass |

Widths were 320, 375, 390, 400, 430, 639, 640, 767, 768, 1023, 1024,
1279, 1280 and 1440px for public pages. The admin matrix also covered the
575/576px Branding transition. Additional routes were session detail,
Speakers, Updates, Travel, Sponsors and Attendees. Footer geometry and link
targets were checked with every route cell.

The machine-readable results are in [summary.json](summary.json),
[public-matrix.json](public-matrix.json) and
[supplemental-matrix.json](supplemental-matrix.json).

## Acceptance status

### Pass

- All six themes and both modes passed at every required width and on both
  sides of the affected breakpoints.
- Normal content, long titles, a long subtitle and URL, long localized
  navigation labels, a dense schedule, and image-present/image-absent heroes
  passed without document overflow.
- Home, Schedule, session detail, a long content page, directories and the
  footer passed in every theme and mode at phone and desktop widths.
- The public and CMS phone titles used the full responsive layout. The maximum
  measured phone title sizes were 38.7px public and 37.6px in CMS preview.
- The Newsroom light Schedule placed its first session at y=738.53px in the
  400 x 844 viewport. Optional filters stayed reachable in one 44px disclosure.
- No matrix cell had horizontal document overflow. Navigation and footer
  targets had a minimum rendered height of 44px.
- The minimum rendered primary-text contrast was 14.06:1. The minimum CMS
  preview text contrast and illustrated-caption contrast were also 14.06:1.
- Illustrated heroes loaded, stayed inside 390px, kept meaningful alternative
  text and displayed a caption in all 12 theme/mode pairs.
- Reduced-motion contexts reported the reduced preference and passed the same
  phone geometry checks in all 12 theme/mode pairs.
- Populated color, logo and icon controls, expanded advanced settings and
  action rows stayed inside every admin viewport. The closed phone rail was
  56px high from 320 through 1023px. The title band scrolled below 640px and
  remained sticky above.
- At 412 x 844 in both modes, all 25 admin destinations opened below the same
  56px top bar with no horizontal overflow. The bar showed the event, current
  section and Menu on one row.
- In both modes, Menu opened a fixed sheet from y=56 through the viewport
  bottom. It retained four separate group labels and 25 full-width rows. Every
  row rendered at least 44px high. The account address and Sign out stayed
  inside the sheet.
- The open phone sheet made the covered work surface inert. Starting the admin
  tour closed the sheet before moving focus into the tour.
- Every CMS phone preview had a 390px browsing context, no overflow, correct
  theme/mode attributes and public text inheritance. The committed browser
  regression also verifies exact public/preview title geometry, type and color,
  Fit/Actual/Compare geometry, and opposite admin/preview modes.
- Existing Branding tests verify draft-only preview behavior, discard on exit,
  complete document publishing and error handling. The saved public header is
  retained in the candidate preview and whole-document publish. The preview
  does not publish.

### Fail

- None.

### Open

- Joe's visual acceptance of the one-row top bar remains open. Automated
  geometry passed on every admin destination in light and dark modes.
- Joe's visual acceptance of the grouped full-width drawer rows remains open.
  Automated geometry, grouping, target size and account placement passed.
- Independent review verification is open. Merge and deployment remain
  separate approval steps.

## Captures

Public 390px examples:

- [Civic light Home](civic-light-390-home.png) and
  [Civic dark Schedule](civic-dark-390-schedule.png)
- [Newsroom light Home](newsroom-light-390-home.png) and
  [Newsroom dark Schedule](newsroom-dark-390-schedule.png)
- [Broadsheet light Home](broadsheet-light-390-home.png) and
  [Broadsheet dark Schedule](broadsheet-dark-390-schedule.png)
- [Atlas light Home](atlas-light-390-home.png) and
  [Atlas dark Schedule](atlas-dark-390-schedule.png)
- [Field Guide light Home](field-guide-light-390-home.png) and
  [Field Guide dark Schedule](field-guide-dark-390-schedule.png)
- [Zine light Home](zine-light-390-home.png) and
  [Zine dark Schedule](zine-dark-390-schedule.png)

The two reported public views are
[Newsroom Home at 400px](newsroom-light-400-home.png) and
[Newsroom Schedule at 400px](newsroom-light-400-schedule.png). The image-present
fixture is [Newsroom Home with an illustrated hero](newsroom-light-390-home-illustrated.png).

CMS preview captures include all six themes in both modes. Admin shell captures
show the [light closed bar](admin-light-412x844-closed.png),
[light drawer](admin-light-412x844-drawer.png),
[dark closed bar](admin-dark-412x844-closed.png) and
[dark drawer](admin-dark-412x844-drawer.png) at 412 x 844px.
