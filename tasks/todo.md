# Session task list

Define and start the CJS parity milestones, M7 first.
Stack the PRs on branches `claude/repo-milestone-completion-sbpk7w-<issue>`, PR base is the previous branch in the stack, root PR is #146.

## M7: Public site completeness

### Wave 1

- [x] #147 Render the navigation from page documents (PR #220)
- [x] #150 Serve per route metadata from the server (PR #229)
- [x] #151 Generate a sitemap, a robots file, and a web manifest at publish time (PR #221)
- [x] #153 Add a countdown and a lifecycle aware home lead (PR #222)
- [x] #157 Seed a recap page and a guidelines page (PR #223)
- [x] #160 Add search and a section index to long content pages (PR #224)
- [x] #161 Add a session recording link field (PR #228)

Stack order for the waterfall merge: #229 into -161, #228 into -160, #224 into -157, #223 into -153, #222 into -151, #221 into -147, #220 into main.

### Wave 2

- [x] #148 Add the sign-in and account control to the header
- [x] #149 Build the footer link list and organizer links
- [x] #152 Reset scroll position on route change and add a back to top control
- [x] #154 Add a configured registration action
- [x] #155 Add an information card arrangement to the home page
- [x] #156 Add a sponsor strip section to the home page
- [x] #158 Seed a city guide page
- [x] #159 Add an uploaded venue map with labelled rooms

Branch grouping: the shell branch carried #148, #149, and #152; the home branch carried #154, #155, and #156; #158 and #159 each had a branch of its own.

### Final tip

- [x] Shorten the seeded page labels (Home, Travel, FAQ, Conduct, Contact, Privacy, Terms, Recap, Guidelines, City guide) and regenerate, and let a page state a heading of its own
- [x] One shared visible predicate for whether a page is public, across navigation, sitemap, and routeMeta
- [x] CHANGELOG entry for M7, roadmap update, regenerated docs
- [x] Lessons from the milestone

## Follow-ups filed during M7

Filed rather than fixed in place: each is outside the issue that surfaced it,
and each is carried into a later milestone.

- [ ] #218 raster app icons (M7)
- [ ] #219 admin save buttons stay enabled (M10)
- [ ] #226 places and movements docs (M10)
- [ ] #227 blank number field in the venue editor (M10)
- [ ] #230
- [ ] #231
- [ ] #233
- [ ] #234
- [ ] #236

## Review

- Every diff gets an Opus review pass before merge.
- Every diff gets the repository's Codex review before merge.
