# Session task list

Expand the design vocabulary until the template reads as designed by a
top-tier studio, then improve it wave by wave. Direction record:
`docs/plans/2026-09-10-design-vocabulary-expansion.md`. Tracking issue: #249.
Branch `claude/admin-cms-design-language-ub69gr` carries wave 1; later waves
stack on it with a `-w2` to `-w6` suffix. Fable directs. Opus, Sonnet, and
Haiku agents build.

## Done before this session's first commit

- [x] Last night's admin restyle merged as PR #245. The designated branch was
      restarted from main.
- [x] Research baseline: platform guidelines, motion grammar, admin CMS UX
      (three of six briefs in; slop tells, event UX, and editorial devices pending).
- [x] Inventory of the design system and the M8 to M12 UI needs.
- [x] Direction record written. Issues #247, #248, #249 filed.

## Wave 1: the grammar

- [x] State grammar on both surfaces: hover inside the hover query, press,
      selected, disabled, busy, error, success, empty; the tint tokens.
- [x] New controls: switch, segmented control, tabs, checkbox, radio, search
      field, sort control, filter group, external link marker.
- [x] Motion grammar: one curve with the asymmetry in duration, enter and
      exit utilities, the static loading device, the motion contract test.
- [x] Closes #219 (submit stays enabled, focus moves to the first error),
      #233 (dialog focus trap), #236 (new-tab marker, sponsor wall included).
- [x] The two widths: a stage for the frame, a measure for running text, and
      the composed first screen on the home page.
- [x] Specimen book route in the demo and in development, with every device
      in every state, and the committed capture script.
- [x] Integration: merge, specimen entries for the new controls and the two
      widths, regenerate, checks last, evidence under
      `docs/plans/evidence/specimen/`.
- [x] Docs: interface guidelines, design reference, web README, CHANGELOG,
      `docs/docs` regenerated.
- [x] Independent review before the pull request opens; its fourteen findings
      verified against the code, fixed, and reported.
- [x] "Feels wrong to humans" pass on the captures; the evidence replaced with
      section captures at full scale, and what they showed fixed.
- [x] Push, open the PR, watch CI and the review bots.

## Wave 2: devices and blocks

- [ ] Text devices: standfirst, pull quote (Zine through the callout),
      byline and dateline, drop cap option, definition list, timeline,
      ruled table.
- [ ] Feedback devices: count, legend, session state marker, meter, notice
      bar, toast tones, loading, empty.
- [ ] Input devices: dropzone, avatar, repeater.
- [ ] Block types and editor mirrors; option groups from §4 of the record.

## Wave 3: illustration sets

- [ ] `typographic`, `registration`, `celestial`, `architectural`; the asset
      test extended to every set.

## Wave 4: schedule and dashboards

- [ ] #162 to #167 on the schedule; #168 and #210 shells.

## Wave 5: site styles

- [ ] Gallery, Playbill, Listings.

## Wave 6: admin devices

- [ ] M9 to M11 pages on the desk; the defects in §11 of the record.

## State at the end of the 2026-09-10 session

Recorded so a fresh context can rebuild the wave from the repository alone.

- Wave 1 is integrated on `claude/admin-cms-design-language-ub69gr`: the three
  builder branches merged, the seams closed, the independent review's findings
  fixed, every check green, the specimen evidence committed as section
  captures. Merged as #254 on 2026-09-10.
- Builder worktrees, kept for reference: `/home/user/wt-w1a`
  (`…-w1a`, 16 commits), `/home/user/wt-w1b` (`…-w1b`, 1 commit),
  `/home/user/wt-w1d` (`…-w1d`, 2 commits). All three are merged into wave 1.
- Wave 3's builder left one commit on `…-w3` (four illustration sets) and six
  uncommitted SVG redraws in `/home/user/wt-w3` (botanical divider, empty
  state, nameplate mark, section mark; cartographic section mark; typographic
  empty state). Decide whether the redraws stay before a fresh W3 builder
  resumes from that worktree.
- Decisions waiting on Joe: the toast tone's second signal is a weak rule; the
  segmented control and the tabs take no disabled prop (wave 2 owns it);
  hover, focus and press are drawn once on the five shared shapes, not per
  composite control; an empty feedback message marks the field and moves
  focus, with no form-level alert.
- Wave 2 branches from the wave 1 tip as `…-w2`, never from main.

## After every wave

- [ ] Independent review against the brief and the slop list.
- [ ] "Feels wrong to humans" pass on the captures; findings fixed.
- [ ] `tasks/lessons.md` updated after any correction.
