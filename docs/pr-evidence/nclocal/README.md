# NC Local render evidence

Desktop: 1280 × 800. Phone: 390 × 844. Images capture the full document at
these viewport sizes. The light images form the paired before/after set.
Dark after images record the second supported mode.

Before: Base `4ae4a1aaae0a5eb8ed0b724a72119b5332d6c93a`, with the same
approved historical content supplied through `GENERATED_DIR`. Its theme CSS,
theme config and neutral branding stay at the base revision. This fixture
overlay makes the visual comparison use the same sessions, people and prose.
The source diff records the replacement of the previous fictional content.

After: Source `7b4a09b2eac2712bc6516df780e509e5b8dd0ab2`, with the committed
historical content and NC Local theme. The after images use the fresh Node 22
lockfile build from Legion, served by a loopback-only local preview. The before
uses the isolated base development server. Both use `VITE_DEMO_MODE=1`.
The browser retained Chromium's sandbox. Navigation used route URLs and
semantic locators; screenshots did not supply click coordinates.

This refresh uses the official Google Fonts Cabin normal Latin 400–700 slice:
28,320 bytes, below the project's existing 60 KB font limit. Its asset source
and digest are recorded in `field-evidence.json`. The prior full CI at `77931662` passed nine tiers, including 3,025 web tests,
2,787 node tests and 352 rules tests. It stopped during E2E collection before
browser cases ran. This source fixes that loader failure and adds six page-heading
regression tests; all 62 E2E cases load. Final exact-head CI and independent
review receipts are recorded separately in the PR.

`render-evidence.json` records headings, fonts, viewport widths, transaction
link checks and checks of the other five style selectors. Their source preset
definitions are byte-for-byte equal to the base revision.

## Paired views

| View | Before | After |
| --- | --- | --- |
| Home desktop | [Before](before-home-desktop-light.png) | [After](after-home-desktop-light.png) |
| Home phone | [Before](before-home-phone-light.png) | [After](after-home-phone-light.png) |
| Program desktop | [Before](before-program-desktop-light.png) | [After](after-program-desktop-light.png) |
| Program phone | [Before](before-program-phone-light.png) | [After](after-program-phone-light.png) |
| Speakers desktop | [Before](before-speakers-desktop-light.png) | [After](after-speakers-desktop-light.png) |
| Speakers phone | [Before](before-speakers-phone-light.png) | [After](after-speakers-phone-light.png) |
| Partners desktop | [Before](before-partners-desktop-light.png) | [After](after-partners-desktop-light.png) |
| Partners phone | [Before](before-partners-phone-light.png) | [After](after-partners-phone-light.png) |

No after view exceeded its viewport width. The historical roster is a text
directory; absent portraits and partner logos do not reserve empty frames.
No email link is exposed in the demo. Program time and room data remain
the supplied historical values.

## Field states

Program captures with `-filled` show actual typed `AI` search text in each mode.
The `-placeholder` Program captures show the empty search control and its
actual `Title, room, speaker…` placeholder. Its paired contrast is 5.66:1
in light mode and 10.90:1 in dark mode, recorded from the rendered colors.
The existing demo Specimen book supplies text input, select and textarea
examples at rest, focused, in error and disabled. The `after-fields-*-filled-visible`
captures contain the typed name and notes recorded in `field-evidence.json`.
The same readback records foreground, background, border, focus and font values.

Native autofill is checked through a temporary local form that copies the real
public field classes and uses `autocomplete=email`. Chromium's Autofill domain
fills the reserved `demo@example.test` value, and the probe verifies `:autofill`.
The `after-fields-*-autofill-visible` viewport captures record that state. The
earlier element crops were blank, were invalidated and removed, and do not count
as visual evidence. The replacements were opened and inspected. This local probe does
not submit or save data and does not add a form to the mock-up. Alpha backgrounds
are composited over the recorded field surface for the contrast calculation.
Disabled controls retain their opacity in the readback; their raw color ratio
is not a claim about the composited disabled presentation. The focused Specimen
variants illustrate focus styling; the typed Program search and active textarea
also record native focus.
These are NC Local demo checks; they do not close #316 acceptance.

## Derived dark logo

The light logo is unchanged. The derived `nclocal-logo-dark.svg` gives the
wordmark a white treatment and retains the original globe colors and interior
arcs. `logo-evidence.json` records the actual compiled asset on the header,
Home partner wall, Partners wall and partner-detail view. The canvas comparison
at 1200 × 260 found zero alpha or globe pixel mismatches; all nontransparent
wordmark pixels are white. The additional partner-detail dark capture records
the larger consumer. These images were opened and inspected.
