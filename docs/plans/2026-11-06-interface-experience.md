# Interface experience: research, changes, and audit record

Date: 2026-11-06. Surfaces: public event site, operator admin, and client console.
Status: implemented for review in [PR #752](https://github.com/CenterCoopMedia/eventrunner/pull/752).
The pull request records the tested revision, hosted results, and inspected visual evidence.

## Direction and scope

The owner requested comprehensive improvements to layout, interactions, microinteractions,
loading, dialogs, transitions, hierarchy, and buttons, supported by current web research.
The owner then explicitly authorized relaxing the earlier restrictions on animation and
colour: **“We can relax the rules about no animation and no color.”**
This direction supersedes conflicting aesthetic refusals in the earlier design records.
Use purposeful colour and motion across all three surfaces while retaining semantic tokens,
legible states, keyboard access, reduced-motion alternatives, and responsive performance.
Update the binding brief, interface guidelines, and motion contract together.

This pass improves shared interaction foundations and demonstrated defects. It does not
complete every design-system milestone or establish whole-application WCAG conformance.
The checklist below preserves the remaining work rather than treating a shared-component
change as proof that every call site, theme, mode, and browser now behaves correctly.

## Evidence and limits

Baseline observations were recorded during the 2026-11-06 source and live-demo review.
The live review used Edge at a desktop viewport of 1912 × 863; the colour sample was the
Newsroom demo. These observations are baseline evidence, not final screenshots of this branch.

| ID | Observed baseline | Consequence and scope |
| --- | --- | --- |
| E1 | The public loader reserves the same three hairline rows regardless of the page. | It does not describe the expected schedule or directory structure. Match the placeholder to the destination and measure the eventual layout shift separately. |
| E2 | A secondary button uses a hairline boundary; the sampled Newsroom/light boundary is approximately 1.35:1, versus approximately 3.79:1 for the control-boundary token. | Use the control token for an identifiable outlined control. These sampled ratios do not establish compliance for other themes, backgrounds, states, or overrides. |
| E3 | Public active-scale styling is not consistently guarded by reduced-motion preferences. | Guard the transform itself; making its transition instantaneous still leaves movement. |
| E4 | `FeedbackModal` can be dismissed during submission and lacks a synchronous submission guard. | Prevent duplicate requests immediately; make close, Cancel, Escape, and backdrop behavior consistent while pending. |
| E5 | Live `FeedbackModal` focus lands on a `SELECT` despite the intended `autoFocus` target. | Explicitly focus the intended element after native modality opens; verify the real browser behavior and focus return. |
| E6 | The current Spectrum Button page was visually inspected. | Its hierarchy, states, and pending guidance inform the controls; adopting its visual shape wholesale is not required. |
| E7 | Hosted browser checks exposed a native Tab boundary gap; the live demo also moves document focus to `BODY` after Tab from the last feedback button while the dialog remains open. | Share the admin's explicit boundary wrapping with public dialogs. Native modality still owns the inert background; test forward and reverse wrapping in the form, pending state, and receipt. |
| E8 | The first hosted captures of the shaped loaders still read as large blank panels between faint rules. | Add still, token-tinted title and detail bars, schedule time markers, and directory portraits so the reserved structure is recognizable. The status label remains the meaningful content. |
| E9 | In the hosted 390px console capture, eight expanded setup steps occupy roughly 400px above the task heading, leaving little team content in the first viewport. The selected step and its focus outline remain distinguishable in forced colors. | Coordinate compact mobile setup navigation with #746. The control and waiting-state improvements do not resolve this existing content-priority problem. |

Source inspection and browser observations answer different questions. Source review can
identify guards and semantics; only rendered checks establish clipping, contrast against the
actual background, focus placement, layout stability, and the feel of a transition.

## Changes in this pass

The following is the implementation scope. Consult PR #752 for the current hosted results
and screenshots; the required-evidence column also identifies the limits of each change.

| Area | Change being made | Required evidence |
| --- | --- | --- |
| Public/admin loading | Immediate named activity; indicator after 1 second; explanatory states after 10 and 60 seconds; optional retry only where the operation is safe to repeat. | Fast response never flashes the indicator; slow work remains understandable; timers clear on completion/unmount; retry cannot duplicate a write. |
| Public placeholders | Still, token-tinted row, schedule, and directory shapes, with representative states in the specimen. | Compare actual destination geometry at narrow and wide widths; record measured CLS separately under #615. |
| Public feedback modal | Explicit initial focus, synchronous submission protection, coordinated pending dismissal, stable action-label width, and predictable focus return. A 20-second request deadline preserves the draft and reports uncertain receipt. | Native browser keyboard path, rapid activation, delayed success/failure, and opener removal/fallback. |
| Public/shared buttons | Stronger outlined boundaries, clearer action hierarchy, distinct state feedback, purposeful small transitions, and motion-safe press feedback. | Actual backgrounds and states across themes/modes; no layout jump or inaccessible busy state. |
| Admin controls | Shared button treatment and editable text of at least 16px for coarse pointers. | Actual phone focus behavior, browser zoom availability, long labels, and form layout. This is not a complete #636 device audit. |
| Motion preference | Replace artificially tiny animation durations with a genuinely static reduced state. | Active transforms, entrances, loops, and scroll behavior remain static without hiding content or outcomes. |
| Client console | Waiting/status explanation and control-state parity within its isolated styles. | Fast/slow/extended states, disabled versus busy treatment, keyboard names, and coarse/fine pointer behavior. |
| Design records | Replace conflicting colour/motion bans with purpose, token, accessibility, and performance rules. | Guidelines and contract checks agree with the authorized direction; generated documentation is updated by the main change. |

## Research decisions

### 1. Buttons and coloured hierarchy

Give each task area one visually dominant action, with secondary and quiet actions carrying
less emphasis. Labels describe the result: “Save speaker”, “Publish schedule”, or “Delete
file”. Reserve destructive treatment for the destructive action itself. Icons add recognition;
they do not replace the words needed to choose a consequential action. Spectrum documents
default, hover, down, focus, disabled, and pending behavior [S6].

Use semantic action, selected, information, success, warning, and danger tokens. A state also
needs a word, icon, outline, or shape. Measure the rendered combination, including hover and
pressed colors, rather than approving a palette in isolation [S1]. Keep button dimensions
stable when the label changes, allow long labels to wrap, and retain usable touch targets.
Disabled styling should remain legible; busy styling should explain what is happening.

### 2. Loading is an operation with an outcome

Show the operation immediately and prevent repeat submissions immediately. Delay only the
decorative pending indicator by about one second to avoid flicker; never hold back completed
content. Spectrum explicitly separates the pending delay from duplicate-click prevention,
and recommends moving longer or determinate progress outside the button [S6].

Use a spinner for unknown progress, and a bar/fraction only when actual measurements exist
[S7]. “Saving speaker…” is more useful than “Loading…”. At 10 seconds, acknowledge the
delay; at 60 seconds, explain available next steps. Those thresholds are Eventrunner design
choices, not WCAG requirements or proof that the request failed. Never invent a percentage,
promise a completion time, or offer an unsafe retry of an unresolved write.

Feedback submissions have a separate 20-second deadline covering both the request and
response parsing. This prevents an indefinitely locked dialog. A deadline is an uncertain
receipt, not proof that the server did not save the message. Retrying the unchanged payload
keeps its submission key, so the server can recognize the same submission. This flow can
reach the 10-second explanation, but does not wait for the generic 60-second stage.

Preserve useful existing content during refresh. Reserve geometry for initial content without
obscuring the operation name. A schedule skeleton and a directory skeleton have different
shapes. Skeletons are decorative; one status region conveys the meaningful update. Announce
results without moving focus, and avoid per-frame, per-second, or duplicate announcements
[S4]. Completion, failure, cancellation, and timeout need distinct lifecycle decisions.

### 3. Motion supports understanding and personality

Spectrum's current guidance allows personality while requiring meaningful motion, and notes
that its expanded motion system is still developing [S8]. Carbon distinguishes restrained
task feedback from occasional expressive moments. Its reference durations include 110ms for
fades, 150ms for small movements, and 240ms for larger communication [S9]. These are useful
anchors, not a reason to import an entire design system or animation dependency.

| Eventrunner interaction | Proposed range | Acceptance rule |
| --- | --- | --- |
| Hover, press, toggle | 120ms | Immediate acknowledgement; no input delay; only available controls respond. |
| Small disclosure or local change | 160–180ms | Explain the changed relationship; avoid shifting the active control. |
| Dialog, popover, notification entrance | 200–220ms | Modality and focus begin immediately, independently of animation completion. |
| Exit | 120–160ms | Closing remains responsive and restores focus safely. |
| Pending indicator | Component-owned cycle around 1.2s | Start after the indicator delay; end with the operation; static equivalent under reduced motion. |

Use named duration/easing tokens. Prefer transform and opacity for movement; localized
button color transitions are permitted. Avoid `transition: all`, layout animation across
large surfaces, staggered content that postpones use, and replaying every row after filtering.
The exact curves should remain coherent with existing tokens. Profile visible paint cost
where color changes or larger transitions are introduced [S12].

Reduced motion removes spatial movement and repeated decorative animation while preserving
the state and readable feedback. The complete end state must remain visible. Do not depend
on `animationend` to make essential content, controls, or focus available. Tiny-duration
global overrides are not a substitute for deliberate static behavior [S12].

### 4. Dialogs, errors, and dense admin work

Use native modality with a meaningful title, deliberate initial focus, an internal keyboard
path, and return focus to a useful connected control. Long or structured dialog text should
not become one oversized accessible description. Destructive decisions may warrant initial
focus on the least destructive option [S3]. Pending dismissal protection must explain the
operation and offer a recoverable failure state; it must not become an indefinite trap.

Keep validation close to its field, preserve entered data, identify the problem in words,
and state how to correct it. A long form benefits from a focused error summary linking to
the affected fields; a short form may focus its first invalid field [S5]. Keep submission
available so a user can discover validation, then guard it when a request actually starts.

A dense list needs a stable sequence: title/context, principal action, search and filters,
result summary, data or empty state, and pagination. Carbon's table guidance groups search,
filtering, sorting, and batch actions around the data they affect [S10]. Retain semantic
tables where comparison matters; use cards only when their structure helps the task.

## Audit checklist and disposition

**Current change** means included in this pull request; its verification record is linked below. **Separate** means another
identified branch or issue owns the work. **Follow-up** means a remaining audit or lifecycle
gap; it must not be marked complete merely because shared styling changed.

| Area | Acceptance checks | Disposition |
| --- | --- | --- |
| Page hierarchy | One clear page identity; descriptive title; primary action beside the task; readable measure; related controls grouped; no decorative container obscuring relationships. | Shared controls: Current change. Layout ownership: #750/#751. |
| Navigation | Current location is explicit; browser Back preserves useful context; mobile disclosure is keyboard operable; collapse preserves focus; no hover-only destinations. | Separate #751; remaining paths need audit. |
| Editor actions | Save/publish outcomes stay beside their action; sticky controls do not conceal fields or errors; widths respond to work rather than arbitrary maximums. | Separate #750; sticky-focus follow-up #658. |
| Public content | Home and schedule keep distinct identities; long titles, images, and multilingual strings fit; schedule day/track controls remain understandable. | Follow-up across six site styles and both modes. |
| Button states | Visible default, hover, pressed, focus, disabled, selected, pending, success, and failure; meaningful names; stable size; no decorative motion on unavailable actions. | Shared treatment: Current change; call-site audit remains. |
| Target size | Meet the 24 CSS pixel minimum or a documented WCAG exception; prefer 44px comfortable touch controls; ensure adjacent targets remain separable [S2]. | Current change for shared sizing; dense row/toolbar audit remains. |
| Focus | Logical order; visible ring; no keyboard trap; focused control not entirely obscured by sticky content; aim for full visibility [S1]. | Feedback modal: Current change; #658 remains. |
| Dialogs | Opening focus, Tab/Shift+Tab, Escape, close, Cancel, backdrop, nested surfaces, submission, and focus return behave consistently [S3]. | Feedback modal: Current change; other dialogs remain separate audit. |
| Forms | Persistent labels, instructions before errors, required/optional clarity, sensible input type/autocomplete, preserved values, linked errors, and actionable validation [S5]. | Shared control polish: Current change; form-by-form audit remains. |
| Multistep work | Current/completed steps have words; validation matches the current step; review allows correction; returning does not erase entries; dirty-state behavior is explicit. | Follow-up; do not replace existing stepper semantics. |
| Authentication | Password managers and paste work; errors do not disclose unnecessary account details; session expiry preserves recoverable work; keyboard authentication remains usable. | Access setup/sign-in work: #746/#748; broader audit remains. |
| Tables and lists | Real headers; announced sort order; labelled selection; truthful selected count; clear selection; no accidental batch action on hidden records [S10]. | Follow-up shared and feature-specific call sites. |
| Search and filtering | Query persists appropriately; active filters and count are visible; clear/reset is available; no-result state names the query; stale responses cannot replace newer results. | Follow-up; preserve existing URL state contracts. |
| Destructive actions | Consequence and affected object are named; pending is guarded; cancel is predictable; success distinguishes the write from a later failed refresh. | Feedback modal protection only: Current change. Wider lifecycle #612/#656. |
| Loading | Immediate label; delayed indicator; truthful long-wait copy; skeleton shape matches content; current content survives refresh; settled work removes every indicator. | Current change; lifecycle handoff #612 and measured CLS #615 remain. |
| Status announcements | One meaningful live update; routine status is polite; urgent alerts are exceptional; no focus movement for ordinary completion [S4]. | Shared loading: Current change; notification duplication needs audit. |
| Empty states | Distinguish first use, no matching results, unavailable data, missing permission, and request failure; give the relevant next step [S11]. | Follow-up, including #656 recovery. |
| Offline and failure | Distinguish an unavailable read from an uncertain write outcome; preserve drafts and visible data; state what retry does; reconcile before repeating consequential work. | Follow-up #656; optional read retry only in this pass. |
| Uploads and long jobs | Real bytes/items/stages where available; cancellability only when supported; per-file failure; resumable context; no fabricated progress or completion. | Follow-up #612 and feature owners. |
| Responsive layout | Reflow at 320 CSS pixels; zoom remains available; wide tables scroll within their own region; long labels and enlarged text do not overlap [S1]. | Shared wrapping: Current change; #750/#751 and full route audit remain. |
| Mobile input | At least 16px editable text for coarse pointers; virtual keyboard leaves the current field and action reachable; focus does not cause unwanted page movement. | Shared admin text: Current change; real iOS/device audit #636 remains. |
| Color and contrast | Text and meaningful non-text states meet their applicable thresholds against actual backgrounds; status never relies on color alone [S1]. | Stronger controls: Current change; all themes/overrides require follow-up. |
| Forced colors | Boundaries, focus, selection, disabled, error, spinner, and tooltip remain distinguishable when author colors are replaced. | Targeted rules: Current change; complete audit #661 remains. |
| Increased contrast | Essential controls and relationships survive stronger contrast preferences; decorative boundaries are not mistaken for sufficient control boundaries. | Follow-up #662. |
| Motion | Every motion has a purpose; shared timings; safe hover media; static reduced state; no dependence on completion events; no focus animation [S8][S9][S12]. | Shared rules: Current change; contract #620 and route audit require evidence. |
| Performance | No content held for an animation; no layout thrash; no animation library without need; stable reserved space; profiler evidence for expensive effects [S12]. | Follow-up measured CLS #615 and hosted performance capture. |
| Content and recovery | Plain language; specific verbs; explain the next action; local persistent result; no “success” for a write that is still pending; uncertainty is explicit. | Loading copy: Current change; broader recovery #656. |

## Coordination with existing work

| Work | Existing scope | Boundary for this pass |
| --- | --- | --- |
| [PR #750](https://github.com/CenterCoopMedia/eventrunner/pull/750) | Contextual widths and editor action anchoring. | Coordinate shared controls and loading; do not copy its layout changes. |
| [PR #751](https://github.com/CenterCoopMedia/eventrunner/pull/751) | Sidebar behavior and public header. | Preserve navigation work and validate shared controls alongside it. |
| [PR #746](https://github.com/CenterCoopMedia/eventrunner/pull/746) | Separate six client setup tasks from read-only hosting status. | Console style parity must preserve that task/status distinction. |
| [PR #748](https://github.com/CenterCoopMedia/eventrunner/pull/748) | Email admin access sign-in instructions and explicit resend; stacked on #746. | Avoid changing access delivery semantics in a visual pass. |
| [#612](https://github.com/CenterCoopMedia/eventrunner/issues/612) | Request lifecycle and handoff. | Shared indicators do not prove every asynchronous operation settles correctly. |
| [#613](https://github.com/CenterCoopMedia/eventrunner/issues/613) | Styled waiting/held-up indicator and mascot drawings. | Reused waiting treatment is not a completed new illustration set. |
| [#615](https://github.com/CenterCoopMedia/eventrunner/issues/615) | Content-shaped loading and measured layout stability. | Shapes advance the issue; measured CLS and destination coverage remain. |
| [#620](https://github.com/CenterCoopMedia/eventrunner/issues/620) | Motion contract. | Align it with the owner's amendment; retain behavioral and accessibility gates. |
| [#636](https://github.com/CenterCoopMedia/eventrunner/issues/636) | Mobile focus zoom. | Shared 16px control text needs real-device verification. |
| [#656](https://github.com/CenterCoopMedia/eventrunner/issues/656) | Recovery experience. | Preserve operation-specific retries, offline distinctions, and unsaved work. |
| [#658](https://github.com/CenterCoopMedia/eventrunner/issues/658) | Sticky focus visibility. | Audit stacked headers/actions at zoom and with the virtual keyboard. |
| [#661](https://github.com/CenterCoopMedia/eventrunner/issues/661) | Full forced-colors audit. | Targeted button rules are only part of the required coverage. |
| [#662](https://github.com/CenterCoopMedia/eventrunner/issues/662) | Contrast preference support. | Remains a separate rendered-state and token audit. |

## Verification evidence and follow-up

The branch includes unit coverage for loading stages and cleanup, request deadlines and
late responses, modal focus and duplicate activation, and shared motion contracts. Hosted
browser coverage exercises public dialogs and loading shapes at 1440, 390, and 320px;
generated default-preset control contrast; reduced motion; targeted forced-colors focus;
coarse-pointer admin text; and controlled console waiting. The generated-preset check does
not substitute for runtime brand overrides or full-page contrast review.

Use the tested revision, workflow and artifact links in PR #752 as the outcome record.
The following checks describe the broader completion criteria, including device and
performance work this shared-component pass does not establish:

- Record the tested commit, hosted workflow links, and actual results; do not infer success from source inspection.
- Capture public schedule/directory, specimen, feedback dialog, admin form, and console at desktop and narrow widths.
- Exercise keyboard only, 200–400% zoom, reduced motion, forced colors, long labels, and all relevant theme/mode combinations.
- Exercise fast, 10-second, and 60-second requests; success, failure, empty results, offline reads, and uncertain writes.
- Check rapid repeated activation before React renders pending state, dismissal while pending, unmount, and timer cleanup.
- Verify the modal's actual initial focus, full keyboard cycle, recovery after failure, and return focus after it closes.
- Measure layout shift during shaped-placeholder replacement; check reflow and active-control position during label changes.
- Confirm animations stop when work settles and reduced motion retains complete content and readable feedback.
- Record remaining defects with the affected route/theme/device and evidence; do not close unrelated backlog by implication.

Real-device behavior, assistive-technology output, full-route preference audits, and measured
layout shift remain separate acceptance work. A passing shared-component check is not a
claim of whole-application conformance.

## Primary references

All references inspected on **2026-11-06**. WCAG requirements and design-system recommendations
are distinguished above; proposed Eventrunner thresholds and implementation choices are not standards.

| Ref | Primary source | Use in this record |
| --- | --- | --- |
| S1 | [W3C WCAG 2.2][S1] | Contrast, reflow, focus, keyboard, and non-color communication requirements. |
| S2 | [W3C Target Size (Minimum)][S2] | 24px minimum, spacing, and exceptions; 44px is the project's more comfortable target. |
| S3 | [WAI APG Modal Dialog][S3] | Initial focus, modality, keyboard interaction, and focus return. |
| S4 | [W3C Status Messages][S4] | Programmatic status without unnecessary focus movement. |
| S5 | [W3C Design System Form Errors][S5] | Linked summaries and actionable field-level errors. |
| S6 | [Adobe Spectrum Button][S6] | Action hierarchy, states, one-second pending delay, and duplicate prevention; current component and its linked behavior/usage fragments. |
| S7 | [Adobe Spectrum Progress Circle][S7] | Determinate versus indeterminate activity, sizing, and meaningful measured ranges. |
| S8 | [Adobe Spectrum Motion][S8] | Purpose, directional meaning, personality, and reduced motion. |
| S9 | [Carbon Motion][S9] | Timing/easing anchors and productive versus expressive motion. |
| S10 | [Carbon Data Table Guidelines][S10] | Search, filter, selection, batch actions, and dense data organization. |
| S11 | [Carbon Empty States][S11] | Distinct empty situations and relevant next actions. |
| S12 | [Chrome UI Motion Guidance][S12] | Efficient properties, progressive enhancement, and deliberate reduced-motion behavior. |

[S1]: https://www.w3.org/TR/WCAG22/
[S2]: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum
[S3]: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
[S4]: https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html
[S5]: https://design-system.w3.org/styles/form-errors.html
[S6]: https://spectrum.adobe.com/web/rsp/components/button
[S7]: https://spectrum.adobe.com/web/rsp/components/progress-circle
[S8]: https://spectrum.adobe.com/foundations/behavior/motion
[S9]: https://www.carbondesignsystem.com/building-blocks/foundations/motion/overview
[S10]: https://www.carbondesignsystem.com/building-blocks/core/components/data-table/guidelines
[S11]: https://www.carbondesignsystem.com/building-blocks/core/patterns/empty-states
[S12]: https://developer.chrome.com/docs/modern-web-guidance/guides/ui-behaviors/motion
