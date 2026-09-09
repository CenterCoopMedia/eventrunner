# Session task list

Define and start the CJS parity milestones, M7 first.
Stack the PRs on branches `claude/repo-milestone-completion-sbpk7w-<issue>`, PR base is the previous branch in the stack, root PR is #146.

## M7: Public site completeness

### Wave 1

- [x] #147 Render the navigation from page documents
- [x] #150 Serve per route metadata from the server
- [x] #151 Generate a sitemap, a robots file, and a web manifest at publish time
- [x] #153 Add a countdown and a lifecycle aware home lead
- [x] #157 Seed a recap page and a guidelines page
- [x] #160 Add search and a section index to long content pages
- [x] #161 Add a session recording link field

### Wave 2

- [x] #148 Add the sign-in and account control to the header
- [x] #149 Build the footer link list and organizer links
- [x] #152 Reset scroll position on route change and add a back to top control
- [x] #154 Add a configured registration action
- [x] #155 Add an information card arrangement to the home page
- [x] #156 Add a sponsor strip section to the home page
- [x] #158 Seed a city guide page
- [x] #159 Add an uploaded venue map with labelled rooms

### Final tip

- [x] Shorten the seeded page labels, and let a page state a heading of its own
- [x] One shared predicate for whether a page is public
- [x] CHANGELOG entry, roadmap update, regenerated docs
- [x] Lessons from the milestone

## Follow-ups filed during M7

Filed rather than fixed in place: each is outside the issue that surfaced it,
and each is carried into a later milestone.

- [ ] #218
- [ ] #219
- [ ] #226
- [ ] #227
- [ ] #230
- [ ] #231
- [ ] #233
- [ ] #234
- [ ] #236

## Review

- Every diff gets an Opus review pass before merge.
- Every diff gets the repository's Codex review before merge.
