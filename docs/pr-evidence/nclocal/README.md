# NC Local render evidence

Desktop: 1280 × 800. Phone: 390 × 844. Images capture the full document at
these viewport sizes. The light images form the paired before/after set.
Dark after images record the second supported mode.

Before: Base `eaf4e2b5857fe0b1349db1e2f6763d8da51bc86d`, with the same
approved historical content supplied through `GENERATED_DIR`. Its theme CSS,
theme config and neutral branding stay at the base revision. This fixture
overlay makes the visual comparison use the same sessions, people and prose.
The source diff records the replacement of the previous fictional content.

After: Source `f250b58d2b249dc30334c5ec609226252f10ed5f`, with the committed
historical content and NC Local theme. The after images use the fresh Node 22
lockfile build from Legion, served by a loopback-only local preview. The before
uses the isolated base development server. Both use `VITE_DEMO_MODE=1`.
The browser retained Chromium's sandbox. Navigation used route URLs and
semantic locators; screenshots did not supply click coordinates.

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
The existing demo Specimen book supplies text input, select and textarea
examples at rest, focused, in error and disabled. The `after-fields-*-filled`
captures contain the typed name and notes recorded in `field-evidence.json`.
The same readback records foreground, background, border, focus and font values.

Native autofill is checked through a temporary local form that copies the real
public field classes and uses `autocomplete=email`. Chromium's Autofill domain
fills the reserved `demo@example.test` value, and the probe verifies `:autofill`.
The `after-fields-*-autofill` captures record that state. This local probe does
not submit or save data and does not add a form to the mock-up. Alpha backgrounds
are composited over the recorded field surface for the contrast calculation.
These are NC Local demo checks; they do not close #316 acceptance.
