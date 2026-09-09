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

- [ ] Shell branch (one agent, three commits): #148, #149, #152
- [ ] Home branch (one agent, three commits): #154, #155, #156
- [ ] #158 city guide
- [ ] #159 venue map (in rework after review)

## Follow-ups filed

- #218 raster app icons (M7)
- #219 admin save buttons stay enabled (M10)
- #226 places and movements docs (M10)
- #227 blank number field in the venue editor (M10)

## Final tip work

- Shorten the seeded page labels (Home, Travel, FAQ, Conduct, Contact, Privacy, Terms, Recap, Guidelines, City guide) and regenerate
- One shared visible predicate across navigation, sitemap, and routeMeta
- CHANGELOG entry for M7

## Review

- Every diff gets an Opus review pass before merge.
- Every diff gets the repository's Codex review before merge.
