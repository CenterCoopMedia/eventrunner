# Preset visual stories — six specs

**Date:** 2026-08-27
**Status:** Settled. Read before preset work starts (brief §7, PR2).
**Binding source:** `docs/plans/2026-08-27-design-system-overhaul.md`. Where this document and the
brief disagree, the brief wins.
**Companion:** `docs/plans/2026-08-27-admin-identity-story.md`, the fixed admin identity.

## How to read this document

Each preset gets one page. Each page has six parts: the story, the vocabulary, three signature
moments, palette words, what the story refuses, and the options.

A story is creative direction. It tells the builder why a device is there. It never grants an
exception to §2.2 (motion), §2.3 (motifs), or §2.4 (anti-patterns).

Four rules apply to every page below, so they are stated once here:

- **One expressive interaction per surface.** The schedule grid holds that slot on the public site
  (§2.2). Every signature moment named below is either static, or functional motion at 120–200ms on
  `transform` and `opacity`, or the schedule grid itself.
- **Every device is a token or a motif slot.** No moment below needs a new component type. The motif
  slots are `section-mark`, `divider`, `nameplate-mark`, and `empty-state` (§3.8).
- **Nothing sits above a title.** No eyebrow-position text anywhere, in any preset, at any size. A
  plain small-caps folio stacked above a headline is still an eyebrow and is still rejected. This
  rule has no exceptions. A folio lives beside a rule at a section boundary, in a margin, or in a
  running header. If a label needs to be near a title, put it below the title or beside it. Two
  things are not eyebrows. Metadata inside the rule-bounded nameplate block is part of the nameplate
  device, wherever it sits inside it: the dates and the edition line are the nameplate. A form
  `<label>` above its own input is a control label, and a builder must never "fix" it. Brief §2.4
  carries the full rule.
- **Dark mode is a place, not a filter.** Each story names what dark mode *is* in its world. The
  palette is authored, never inverted (§3.3).

### What every story may assume

These four assumptions come from the CJS2026 production site. Every story below builds on them, so
they are stated once.

- **Grounds are tonal.** No ground is pure white and no ground is pure black. Broadsheet, Zine, and
  Field Guide run warm. Newsroom and Atlas run cool, as §4 requires. Civic runs a neutral off-white
  that still clears the highest contrast bar. A stark white ground is the tell this system is
  avoiding.
- **Ink is near-black, not black.** The darkest ink in every light palette carries a trace of the
  theme's hue. Pure `#000` never appears.
- **Elevation is tint, not shadow.** Where a surface must sit above another, it shifts tone with a
  low-opacity overlay of the theme's ink or accent. Grey drop shadows are not used. This follows
  §2.1: shadow decorates nothing.
- **The schedule has a real data model.** Sessions nest: a parent session can hold child items.
  Concurrent tracks are lettered A, B, C. A print-optimised view exists. Every story below assigns
  those three facts a role rather than treating them as plumbing.

### How the options work

Part 6 of each page lists curated options. A theme ships a story with room to move, not one fixed
look. The theme editor turns each option list into a picker. Raw token override stays the advanced
path (§5.2).

These rules bind every option:

- An option remaps existing tier 2 and tier 3 tokens. An option never adds a property name and never
  adds a class (§3.4). An option is a data change in the preset file.
- Every option must keep the story coherent. Each one below states in one sentence why it still
  belongs. An option that needs a different story is a different preset.
- Every heading-face option must be a bundled, self-hosted, Latin-subset `woff2` under an SIL Open
  Font Licence or equivalent, and must pass the four §9 tests. Weight budget is real: prefer a face
  the repo already bundles where the story allows it.
- Every option must define both modes and must pass the §8.1 contrast bar in both.
- An option never unlocks a banned pattern. The §2.4 list applies to every combination.

---

## 1. Broadsheet — `data-theme="broadsheet"`

### 1. The story

You are holding the paper of record for this event. The nameplate runs across the top the way a
daily paper's does, and it is the loudest thing on the page because the paper's name is the paper's
authority. Everything under it behaves like a document that will be kept: tight columns, rules
instead of boxes, a schedule that reads as a printed programme rather than a feed. Nothing is
staged, nothing is sold to you — the type simply sets one thing above another and you know where you
are. This preset promises a long record, and it keeps the promise by looking like something worth
filing.

### 2. The vocabulary

- **Nameplate** — the paper's masthead. Event name, dates, edition line. Type and rules only.
- **Folios** — the standing heads a subeditor sets: SCHEDULE, SPEAKERS, DAY TWO. Small caps beside a
  rule. Never a chip.
- **Rules** — the column rules and the cut-offs of a broadsheet page. They divide, they do not
  decorate, and they never carry the accent.
- **Schedule grid** — the printed programme page. Time down the left edge, lettered tracks A, B, C
  across the head like the column letters of a listings page. A parent session and its children set
  as one entry with the children indented under it, the way a paper sets a lead item and its
  sub-items.
- **Print view** — the edition itself. Print is not an afterthought here; a Broadsheet schedule
  printed on paper should look like the page it was always imitating.
- **Type roles** — heading is the masthead and the deck (Libre Caslon Display). Body is the news
  column (Libre Caslon Text). Data and mono are both the agate (Source Serif 4): captions and
  metadata in the data role, times, room numbers, and counts in the mono role with tabular figures.
  Broadsheet is the one preset that runs a serif in the mono role, because a listings column in a
  paper is set in agate, not in a typewriter face.
- **Motifs** — off by default. If a client enables `botanical` or `fauna`, they read as the small
  engraved cuts a paper drops beside a standing head. Ink only, three per page at most.
- **Back issue** — yesterday's edition, still on the shelf. Archive tokens, "Back issue" folio, live
  controls removed, nothing hidden.
- **Dark mode** — the late edition. The press has run, the ink sits heavy on a deep neutral ground,
  and the paper stock has gone warm. The accent lifts to hold contrast on that ground.

### 3. Three signature moments

1. **The nameplate takes the fold.** On the home page the nameplate sits above a `--rule-nameplate`
   and a single-line edition slug (dates and city) below it. The next element is the lead session,
   set at `--text-h1`. No image, no banner, no intro paragraph above the name.
2. **The schedule reads as a programme page.** Day heads are folios on a rule. Rows are hairlines,
   not cards. Times sit in the mono role — the same agate serif — with tabular figures, so the left
   edge stays a true column.
   Track letters head the columns; child sessions indent under their parent on a shared hairline.
   The grid's signature interaction is the one expressive moment in the theme: a track column comes
   forward on a user action, under 600ms, readable at every frame, and truly static under
   `prefers-reduced-motion`. The print view drops the grid to a ruled two-column programme that a
   registration desk can hand out.
3. **The past day is set as a back issue.** When a day ends, its page keeps every word and drops to
   the archive tokens, with the "Back issue" folio on the day head. The reader senses an archive,
   not a disabled page.

### 4. Palette words

- **Light:** newsprint white, press black, deep ink-blue, warm rule grey, gutter grey, agate grey,
  margin white, archive grey.
- **Dark:** late-edition charcoal, warm bone type, lifted ink-blue, smoke-grey rule, banked ink,
  press-room grey, dim agate grey, muted archive grey.

### 5. What this story refuses

- **Refuses the second loud voice.** Nothing may compete with the nameplate — no oversized primary
  action, no accent-filled block, no second display size on the same screen.
- **Refuses boxes.** If a divider is needed, it is a rule. A card border here reads as a different
  medium.
- **Refuses nostalgia props.** No paper texture, no torn edges, no faux halftone, no sepia. The
  authority comes from measure and rules, not from costume.
- **Declined from CJS2026:** the offset stamp shadow and the hand-drawn marginalia. A paper of
  record does not carry handwriting in its margins, and an offset ink layer would read as damage
  rather than as design here.

### 6. The options

**(a) Heading face — the paper's era.**

1. **Libre Caslon Display** *(default)* — the paper of record founded in the 1820s. It is the
   canonical masthead voice and the reason the story reads as authority.
2. **Libre Baskerville** — the same paper, founded sixty years later. Its more even colour and open
   counters keep the authority while reading a shade less antique.
3. **Spectral (semibold at display size)** — the paper of record that redesigned in this century.
   It holds the serious register while giving a modern client a masthead that does not look
   inherited.

**(b) Nameplate treatment — the masthead layout.**

1. **Full measure** *(default)* — name across the full column width, `--rule-nameplate` under it,
   edition slug below. The front page of a broadsheet, exactly.
2. **Centred with a double rule** — name centred between a rule above and a rule below, dates
   flanking it. This is the ceremonial masthead a paper uses on an anniversary edition, so it stays
   inside the story while reading more formal.
3. **Compact left with a standing edition line** — name left, edition line right, one hairline
   under both. This is the running head on an inside page, which is why it fits inner pages and the
   `nameplate-compact` header variant.

**(c) Component variant — the schedule presentation.**

1. **Ruled programme** *(default)* — hairline rows, times in the agate column. The printed
   programme page.
2. **Agate block** — tighter leading, smaller data step, times and rooms set as a dense listings
   column. This is the classified and listings page of the same paper, so the density reads as
   another part of the document rather than a different design.

---

## 2. Newsroom modern — `data-theme="newsroom"`

### 1. The story

You have opened a well-made news site on a good day. A designer set the headlines, and they have a
voice; a different, quieter face carries the reading underneath, and the numbers are handled by a
third face that knows it is furniture. Sections are named and separated by a single strong rule, so
the page has a table of contents you can feel while scrolling. It is current without being software:
no dashboard framing, no product marketing, just a desk that publishes. This is the preset a client
picks when they want the site to look edited.

### 2. The vocabulary

- **Nameplate** — the site's masthead bar. Compact, confident, and repeated on every page so the
  reader always knows the publication.
- **Folios** — the section heads a desk uses: PROGRAMME, SPEAKERS, TRAVEL. One strong rule opens a
  section; hairlines run inside it.
- **Rules** — the desk's own hierarchy. One `--rule-strong` per section, hairlines everywhere else.
  The strong rule is the only structural emphasis the theme allows.
- **Schedule grid** — the live programme. Lettered tracks A, B, C across, time down, built to be
  scanned mid-morning on a phone and then again on a laptop. A parent session opens as a disclosure
  and its children list under it in the data face.
- **Print view** — the printable programme a desk still publishes as a PDF. Grid becomes a clean
  ruled list, filters and controls drop out, source lines stay.
- **Type roles** — heading is the designed headline (Fraunces). Body is the calm read (Newsreader).
  Data is the desk furniture: captions, labels, and support lines (IBM Plex Sans). Mono is the
  figure column: timestamps, counts, and figures (IBM Plex Mono, tabular). Numbers never borrow the
  headline face.
- **Motifs** — off by default. If enabled, restrained flat marks act as small desk marks at section
  heads and at the end of a long read. Ink only.
- **Back issue** — the archive page of a publication that keeps its archive tidy and public.
- **Dark mode** — the night desk. The room is charcoal, the type is soft white, and both accents are
  retuned for that room rather than reused from daylight.

### 3. Three signature moments

1. **The section rule as a table of contents.** Every named section opens with a folio sitting on a
   `--rule-strong`. The rule width is identical across the site, so a reader scrolling a long page
   counts sections without reading them. This is what replaces the banned sectionless scroll.
2. **The stat block that states a finding.** Every number on the site ships the four-part contract:
   takeaway title in the heading face, description, source line with a read date in the data face,
   and alt text that gives the finding. "Two thirds of sessions are workshops" is the headline; the
   figure is evidence under it. A big number with a caption is rejected here by design, not by
   review.
3. **Filters and disclosure resolve in place.** On the schedule and speaker lists, filter changes and
   parent-session disclosure animate at 150ms on `opacity` and `transform` only, `ease-out`, with the
   result count updating in the data face. Track letters stay visible while filtering so a reader
   never loses their column. Route changes and focus moves stay instant. Under
   `prefers-reduced-motion` the change is a swap with no animation at all.

### 4. Palette words

- **Light:** cool newsprint white, desk black, one saturated editorial accent, muted data slate,
  hairline silver, section-rule graphite, caption grey, archive fog.
- **Dark:** charcoal desk, screen-lit soft white, night-retuned editorial accent, dimmed data slate,
  graphite rule, ash grey, low-lamp caption grey, archive slate.

### 5. What this story refuses

- **Refuses product framing.** No SaaS subheads, no self-justifying blurbs, no feature grid, no
  eyebrow above a headline. The site publishes an event; it does not pitch a platform.
- **Refuses accent inflation.** Two accents exist: one editorial, one for data. They never spread to
  rules, card edges, or backgrounds.
- **Refuses the trend tell.** No default-typeface look, no gradient, no glass, no pill. "Current"
  here means well-set, not fashionable.
- **Declined from CJS2026:** the offset stamp shadow and the marginalia. A publication does not
  annotate itself, and offset layers would undo the flat texture §4.2 sets. Tinted-overlay elevation
  covers every case where a surface needs to sit above another.

### 6. The options

**(a) Heading face — the desk's headline voice.**

1. **Fraunces** *(default)* — the designed headline. Its soft-serif wonk is what makes the site read
   as edited rather than generated.
2. **Newsreader at display weights** — the wire-service desk. Running the body face up to headline
   size gives a quieter, more traditional publication that still belongs to the same newsroom.
3. **Archivo (bold, condensed at nameplate size)** — the sans-headline desk. Grotesque headlines are
   a real newsroom tradition, and they keep the story while letting a client trade warmth for punch.

**(b) Nameplate treatment — the masthead bar.**

1. **Rule-bounded bar** *(default)* — name left, dates right, `--rule-strong` under the whole bar.
   The standing masthead of a site that publishes every day.
2. **Stacked with a deck** — name on one line, a single-sentence deck under it in the body face,
   hairline below. The deck is a newsroom device, not marketing copy, so it must state a fact about
   the event.
3. **Section-aware bar** — the masthead bar carries the current section folio to its right on inner
   pages. This is the running head of a news site and reinforces the table-of-contents idea in
   moment 1.

**(c) Component variant — the session card.**

1. **Hairline row** *(default)* — a hairline-separated row with title, time, track, speaker. The
   listing of a publication.
2. **Lead-and-rest** — the first session of a day sets larger with a one-line summary, and the rest
   stay as hairline rows. This is the lead story and the digest under it, which is how a news page
   ranks things without cards, shadows, or colored edges.

---

## 3. Zine / indie — `data-theme="zine"`

### 1. The story

Someone made this by hand, at a copier, the week before the event. The display face is loud and
slightly wrong in the way hand-cut lettering is wrong, and it does all the shouting so the rest of
the page can stay flat and calm. The body is mono, which gives every line the same even rhythm — the
typewriter under the poster. Space is generous and the accent is rare, appearing maybe twice on a
page, at full strength, where it means something. Blocks sit on the page like stuck-down paper, with
a second ink pass just off register behind them, and someone has gone through with a pen and marked
the two things that matter. It is playful without being messy, because a good zine is a designed
object that pretends not to be.

### 2. The vocabulary

- **Nameplate** — the flyer headline. The event name set very large in the display face, sitting on
  a strong rule. It is the poster you would staple to a pole.
- **Folios** — the marker-pen section labels of a photocopied programme. Small caps, plain, on a
  rule.
- **Rules** — few and heavy. This theme uses `--rule-strong` where the others use hairlines, so the
  page reads as cut-and-pasted blocks rather than a ruled document.
- **Schedule grid** — the back page of the flyer, where the times are listed because people need
  them. Plain, mono, unironic. Tracks are lettered A, B, C, hand-labelled the way a room list is.
  A parent session and its children read as one block with the children set in under it.
- **Print view** — the point of the whole object. A Zine schedule prints to a single sheet that
  folds; the stamp layer, the grain, and the marginalia all drop out so the toner does not smear.
- **Stamp** — the second ink pass, printed just off register. A hard, unblurred offset layer sits
  behind a session block in ink or accent tint, with no blur and no gradient. It is a printing
  artefact, not depth. Provenance: the CJS2026 production site.
- **Marginalia** — the pen that went over the page afterwards. Three marks only: a squiggle
  underline, a sketch-circle around a label, and one tilted handwritten callout. The squiggle and
  the circle are hand-drawn motif assets; the callout is real copy, so it is text, not a drawing.
- **The rare accent** — spent twice per page at full strength, never more. Because it is rare, it
  reads as intent.
- **Empty state** — a blank flyer. The `empty-state` motif renders as an unmarked sheet with one
  plain line under it: "No sessions posted yet."
- **Type roles** — heading is the hand-cut poster lettering (Karrik by default; see part 6). Body is
  the typewriter (Fragment Mono). Data and mono are the same typewriter, holding captions, times,
  and room numbers with tabular figures. Zine runs one mono across all three roles on purpose: the
  even rhythm is the story. The handwritten callout runs on a component token, `--callout-font`,
  which defaults to the bundled script face Caveat; a client may point it at `--font-heading`
  instead. A component token is not a semantic role, so this adds no fifth role (§3.1, §3.2).
- **Motifs** — off by default. If enabled, hand-drawn linework acts as the marker doodle in the
  margin: one `divider` between long sections, one `empty-state` drawing, nothing more.
- **Texture** — paper grain at low opacity is allowed here and only here, with
  `pointer-events: none`. It is the copier, not a filter.
- **Back issue** — last year's flyer, still up on the wall, sun-faded to the archive tokens.
- **Dark mode** — the negative. Toner-black ground, paper-white ink, as though the same page were
  photocopied inverted. The accent stays the same hue and drops in chroma so it stays legible.

### 3. Three signature moments

1. **The nameplate fills the sheet.** On the home page the event name runs at `--text-nameplate`
   across the full measure, breaking across two or three lines, over a `--rule-nameplate` at strong
   width. Below it: date, place, one line. Nothing else above the fold.
2. **The session block is stamped, and it peeks.** Each session block carries a hard offset layer
   behind it: same shape, no blur, no gradient, tinted with ink or the accent, offset by a fixed
   small amount. On hover and on `:focus-visible` the block lifts and the offset layer slides
   further out, like a sticker peeling or a second sheet sliding from under the first. Bind it:
   `transform` and `opacity` only, 150ms, `ease-out`, started by a user action, no state where the
   text is unreadable, and completely static under `prefers-reduced-motion`. The link is the
   affordance; the stamp is never the only signal that a block is interactive. **The brief grants
   this moment a written exception.** §2.1 says shadow decorates nothing and §2.4 rejects
   box-behind-box layering; §2.4 "Exception two: the Zine stamp" names it as a flat, unblurred ink
   layer, permits it in Zine only, and keeps both rules intact everywhere else. Build it against the
   six tests listed there.
3. **The pen has marked two things.** One page carries at most two marginalia marks: a squiggle
   underline under a folio or a callout line, and a sketch-circle around one label such as the
   live-now marker. One tilted handwritten callout may appear per page, at a single fixed angle, set
   in the callout font, carrying real copy a visitor needs. Bind it: drawn marks are motif assets, so
   they are `aria-hidden`, `pointer-events: none`, and inherit ink; no mark ever lands on a single
   word inside a headline, which keeps the theme clear of the banned headline-underline trick; the
   marks are static, with no draw-on animation of any kind.

### 4. Palette words

- **Light:** bright flyer paper, toner black, one hot accent, xerox grey, paper grain, staple
  silver, cut-edge white, faded archive grey.
- **Dark:** night toner black, paper-white ink, held-back hot accent, ghost grey, low-light grain,
  streetlight silver, matte rule black, sun-faded archive grey.

### 5. What this story refuses

- **Refuses polish creep.** No soft radius, no blurred or grey shadow, no tidy card grid. The stamp
  layer is hard-edged ink at a fixed offset; the moment it gains blur or a grey tint it becomes the
  agency drop shadow this story exists to avoid.
- **Refuses mess as a substitute for design.** No scattered rotation, no stickers, no overlapping
  type, no torn-paper collage. One tilted callout per page is a deliberate mark; a page of tilted
  things is noise.
- **Refuses marginalia inflation.** Two drawn marks per page, one callout, and no mark on a headline
  word. Marginalia that annotates everything annotates nothing.
- **Refuses the second loud element.** If the display face is shouting, the accent, the rules, and
  the texture all stay quiet. Two loud things read as noise.

### 6. The options

**(a) Heading face — decided. Three picks, all SIL OFL 1.1.**

1. **Karrik** *(default)* — Velvetyne, drawn by Jean-Baptiste Morizot and Lucas Le Bihan. Its
   deliberately mismatched shapes come from found and copied lettering, which is exactly the
   made-at-a-copier voice the story needs.
2. **Bagnard** — Love Letters, drawn by Sébastien Sanfilippo, from Napoleonic-era prisoner graffiti.
   It carries the same hand-cut origin with more weight and menace, for a louder, rougher event.
3. **Avara** — Velvetyne, drawn by Raphaël Bastide. It is a transitional serif with the curves
   replaced by straight segments, so every bowl reads as a cut facet. That gives the story a
   blunter, funnier register — a poster cut from flat stock rather than drawn — without softening
   it.

All three ship bundled, so a client picks one from the theme editor. Bind: whichever face is picked,
it stays the only loud element. The body mono, the accent count, and the rule weight do not change
with the pick. The handwritten callout runs on `--callout-font`, which defaults to Caveat; it is
used for callouts only, one per page, and Caveat clears the same four tests in brief §9. A client
who wants no script face points `--callout-font` at `--font-heading`.

**(b) Nameplate treatment — the flyer headline.**

1. **Full sheet** *(default)* — name at `--text-nameplate` across the full measure, wrapping to two
   or three lines, on a strong rule. The stapled poster.
2. **Stacked block** — each word on its own line, flush left, set solid with the leading closed up.
   This is how hand-lettering fills a sheet, so it stays hand-made without any rotation or collage.
3. **Boxed bill** — the name inside a heavy rule box with the date line under the box. The show bill
   pinned to a noticeboard; a box drawn in strong rules is a printing device here, not a card.

**(c) Component variants — the session block and the folio.**

1. **Stamped block** *(default)* — the hard offset ink layer with the peek-out on hover and focus.
   Misregistration is what a two-pass print looks like, which is the story's whole production
   method.
2. **Flat block** — the same block with the stamp layer off, keeping the strong rule and the
   hairline separation. This is the single-pass photocopy, so it stays in the story and gives a
   client an option that needs no exception to §2.1.
3. **Struck folio** — the folio set in the mono face between a strong rule above and below. The
   typewriter section break of a photocopied programme; plain text plus rules, no chip or badge.

Bind: the marginalia set is its own on/off control, independent of the block variant, because a
client may want the stamp without the pen.

---

## 4. Civic / institutional — `data-theme="civic"`

### 1. The story

This is the public record of a public event. The page behaves like a well-run agency notice: plain,
patient, and unambiguous, with nothing between you and the information. Headings carry weight
without drama, labels say exactly what they label, and every control is large enough to hit on the
first try. Nothing here is trying to have a mood — the design's ambition is that a person on a slow
connection, on an old phone, with a screen reader, gets the same clear answer as everyone else. Its
character is the confidence of a document that does not need to persuade you.

### 2. The vocabulary

- **Nameplate** — the letterhead. The institution's line, the event name, the dates. Formal, even,
  and identical on every page.
- **Folios** — the numbered headings of an official document. Small caps on a hairline, spaced
  evenly, in the same place every time.
- **Rules** — even hairlines throughout. No hierarchy games. Predictability is the point.
- **Schedule grid** — the posted agenda. Time down, lettered tracks A, B, C across, with a list
  baseline that is the equal of the grid rather than a lesser version of it. A parent session and its
  children are marked as such in words, not by indent alone, so the relationship survives a screen
  reader.
- **Print view** — the handout. Civic events post paper agendas, so the print view is a first-class
  page: full contrast, no controls, every session and child listed, tracks named by letter.
- **Type roles** — heading is the document heading (Merriweather). Body is the running text of the
  notice (Public Sans). Data is the label and the table heading (Public Sans). Mono is the value:
  times, room codes, counts, and identifiers (IBM Plex Mono, tabular).
- **Motifs** — off by default, and expected to stay off. If a client enables a set, restrained flat
  marks may sit at the `section-mark` slot only.
- **Semantic color** — set for clarity, never for style, and never used alone. Every status carries
  a word and, where useful, a shape.
- **Back issue** — the closed record. Archive tokens, "Back issue" folio, controls removed, every
  word still readable and still linkable.
- **Dark mode** — the same document under a different lamp. An evening reading room: dark neutral
  ground, high-contrast text, the same restrained accent retuned. Contrast never drops for mood.

### 3. Three signature moments

1. **The agenda list is first-class.** The narrow-viewport list is designed, not degraded: each
   session is a hairline-separated row with time, title, track letter, and room in fixed order and
   fixed positions, tabular figures aligned down the left. Child sessions carry a stated
   relationship, such as "Part of: Opening plenary". A visitor who never sees the grid loses nothing,
   and neither does a visitor who prints the page.
2. **Every control is a stated action.** Buttons start with a verb and name the consequence, hit
   areas meet 44×44px on touch, and `:focus-visible` is styled with a visible outline in both modes.
   There is no "Contact now" that only opens a mail client — an action exists only where a workflow
   exists behind it.
3. **The contrast check is part of the identity.** In the admin theme editor, a Civic override that
   fails contrast on a defined foreground and background pair is a publish-time error, not a
   warning (§5.2): the editor states the pair, the mode, and the measured ratio, and `updateTheme`
   refuses the write. A client who overrides a Civic token into failure has broken the preset's
   promise. The preset's story includes refusing its own misuse.

### 4. Palette words

- **Light:** document off-white, statute near-black, restrained civic blue, form-grey rule,
  hearing-room slate, plain caution amber, plain confirm green, record grey.
- **Dark:** evening-office neutral, high-contrast bone text, retuned civic blue, lamp-grey rule,
  night slate, caution amber held bright, confirm green held bright, archive grey.

### 5. What this story refuses

- **Refuses mood at the cost of contrast.** No soft grey subtext, no low-contrast placeholder, no
  tinted body text. If a choice is between atmosphere and legibility, legibility wins without
  discussion.
- **Refuses decoration.** No motif density, no texture, no accent-filled panels, no colored card
  edges. Ornament here reads as a public body wasting money.
- **Refuses novelty layout.** No bento grid, no asymmetric feature block, no clever section. The
  same structure repeats page to page so a returning visitor never relearns the page.
- **Declined from CJS2026:** the offset stamp shadow and the marginalia, both of them. A public
  record carries no annotation and no printing artefact. Civic keeps the tinted-overlay elevation and
  the tonal ground and nothing else from that study.

### 6. The options

**(a) Heading face — the institution's register.**

1. **Merriweather** *(default)* — weight without drama. It is the USWDS pairing and it reads as a
   body that has existed for a while.
2. **Source Serif 4** — the same document, lighter on its feet. It keeps the formal register while
   suiting a university or a cultural institution rather than an agency, and the repo already
   bundles it for Broadsheet.
3. **Public Sans (bold)** — the all-sans document. Running one face for headings, labels, and data
   is the plainest possible public notice, which is the story taken to its logical end.

**(b) Nameplate treatment — the letterhead.**

1. **Institutional letterhead** *(default)* — event name first, with the organisation line and the
   dates below it, all inside the rule-bounded nameplate block over a hairline. The top of an
   official document. The organisation line sits below the name, never above it.
2. **Two-part lockup** — the client logo slot left, the event name and dates right, divided by a
   vertical hairline. This is the co-signed notice of a partnership, which is the common Civic case.
3. **Compact standing head** — one line: event name, then dates in the data face, hairline under.
   For inner pages, where the reader wants the content and not the letterhead again.

**(c) Component variant — the schedule presentation.**

1. **Posted agenda** *(default)* — hairline rows, fixed column order, tabular figures. The list is
   first-class at every width.
2. **Numbered agenda** — each session carries its real agenda number in the data face at the left.
   The numbers are content, not decoration, and they are never zero-padded, so this stays clear of
   the banned `01 / 02 / 03` pattern while matching how a formal programme is published.

---

## 5. Field Guide — `data-theme="field-guide"`

### 1. The story

You are reading a naturalist's expedition handbook for this event. You arrive at a plate — a framed
drawing with a hairline border and its own plate number — and then you read the labels: name, date,
place, set in a small ruled block the way a specimen is tagged in a collection. The schedule reads as
observation notes taken in the field, patient and dated, and the speaker page reads as the index at
the back of the book. The palette stays quiet and earthy so the linework carries the character, the
way a good plate lets ink do the work. Nothing rushes; the whole site has the tempo of someone who
sat still long enough to see something.

### 2. The vocabulary

- **Nameplate** — the title page of the handbook. Event name, dates, and edition line inside a
  hairline frame, with the `nameplate-mark` motif slot holding one small engraved cut.
- **Botanical plate** — a framed drawing with a double rule at the frame and a plate number in the
  folio style. It opens a page or a section. It is never a hero image and never carries a photo.
- **Specimen label** — a small ruled block stating a name, a date, and a place. It carries session
  metadata and speaker credit lines. It sits below the title it labels, or beside it, never above it.
  It is never a chip and never gets a pill radius.
- **Folios** — the collection labels: PLATE IV, DAY TWO, FIELD NOTES. Small caps on a hairline.
- **Rules** — the ruled sheet of a herbarium mount. Even hairlines, doubled only at a plate frame.
- **Schedule grid** — a page of observation notes. Time down the left as the observation column,
  lettered tracks A, B, C across the head as the sites observed. A parent session and its children
  read as one specimen with its parts labelled under it, the way a plate numbers the parts of a
  single organism.
- **Print view** — the pressed page. The schedule prints as a dated observation sheet: plate number,
  collection date, ruled entries, no controls.
- **Pencil line** — the one piece of marginalia this theme allows. A thin hand-drawn underline, in
  the observation-notes register, sitting under a specimen label or a note line. It is a pencil mark
  in a notebook, never a highlighter and never a flourish.
- **Type roles** — heading is the plate caption and the book's title face: **Besley**, a Clarendon
  revival whose blunt bracketed serifs are the lettering of a printed plate. Body is the field
  narrative: **Vollkorn**, a warm text serif that reads long and never competes with linework. Data
  and mono both point at the specimen label hand: **IBM Plex Mono** with tabular figures, exact
  enough to tag a collection. A label in this world is a tag, and a tag is set in the exact hand.
- **Motifs** — `botanical` on by default, `fauna` supported, both in engraving and botanical-plate
  linework. Ink only, `aria-hidden`, at most three per page.
- **Back issue** — a pressed specimen. The past day dries to the archive tokens and keeps its label.
- **Dark mode** — night observation. A deep forest-neutral ground, warm bone-white text, the palette
  of a lamp on a field table. Both accents lift for the dark ground; the light values are never
  reused.

### 3. Three signature moments

1. **The day head is a plate number and a collection date.** Each schedule day opens with a folio
   reading `PLATE III · SATURDAY 14 MARCH`, set on a hairline, with the plate number drawn from the
   day's real position in the programme. Numbers are never zero-padded and never decorative — they
   count real days, which is what keeps this out of the banned `01 / 02 / 03` pattern.
2. **The speaker page is a specimen index.** Each speaker renders as a specimen label: name in the
   heading face, then role, organisation, and location in the data face on a ruled block, hairline
   separated, alphabetised. One pencil line may sit under a single field where a note belongs — at
   most one per page, drawn from the motif layer, `aria-hidden`, static. The result reads as the
   index of a collection rather than a grid of profile cards. No card, no border box, no colored
   edge.
3. **The empty state is an unlabeled plate.** A section with no content yet renders the
   `empty-state` motif inside the plate frame with the label line blank and one plain sentence under
   it: "Nothing collected here yet." Static, decorative to a screen reader, no animation of any kind.

### 4. Palette words

- **Light:** warm plate stock, bark-brown ink, deep leaf green, muted clay, lichen-grey rule,
  herbarium cream, pressed-tan archive, pencil grey.
- **Dark:** deep forest neutral, bone-white text, lifted moss green, lifted clay, moth-grey rule,
  lantern warmth, nocturne slate, faded field-note grey.

### 5. What this story refuses

- **Refuses the photograph.** No nature photography, no leaf background, no plant image behind the
  nameplate. A plate is drawn linework, and the moment a photo appears the register collapses into a
  wellness template.
- **Refuses the green wash.** The accent is a single deep leaf green used sparingly. No green
  backgrounds, no green rules, no eco-brand gradient.
- **Refuses decorative botany.** A motif appears where a plate or a section mark belongs. Vines
  around the header, scattered leaves, and filler flourishes break the §2.3 density rule and the
  story at once.
- **Refuses the playful pen.** The pencil line is quiet, thin, and rare. No squiggle, no
  sketch-circle, no handwritten callout, no tilt. A field notebook is written by someone being
  careful.
- **Declined from CJS2026:** the offset stamp shadow. A plate is printed once, on good stock; a
  misregistered second pass reads as a fault, not as character.

### 6. The options

**(a) Heading face — the pairing is settled: Besley, Vollkorn, IBM Plex Mono. Three heading options
around it.**

1. **Besley** *(default)* — the printed plate caption. Its Clarendon weight holds a title page and
   still sits calmly under a drawing, which is the core Field Guide relationship.
2. **Vollkorn (bold at display size)** — the one-face volume. Running the body serif up to heading
   size gives a pocket handbook rather than a plate book: quieter, closer to the reading, and it adds
   nothing to the font budget.
3. **Spectral (semibold)** — the collector's volume. Its finer, sharper serifs read as the
   frontispiece of a formal edition, so the story gains a more scholarly opening without leaving the
   handbook.

Body stays Vollkorn and data stays IBM Plex Mono under every option. Only the heading role moves.

**(b) Nameplate treatment — the title page.**

1. **Framed title page** *(default)* — name and dates inside a hairline frame with the
   `nameplate-mark` motif above the name. The opening plate of the handbook.
2. **Plate-and-label** — a `botanical` plate to one side, the name and dates set as an oversized
   specimen label beside it. It states the book's subject the way a frontispiece plate does, and the
   plate stays drawn linework, never a photo.
3. **Ruled title, no frame** — name, dates, and edition line between a double rule above and a
   hairline below. The title page of a cheaper printing of the same book; quieter, and better for
   text-heavy events.

**(c) Component variant — the session presentation.**

1. **Specimen label** *(default)* — a small ruled block: name, date, place. The collection tag.
2. **Field notes column** — sessions run as a continuous dated column with hanging times in the data
   face and hairlines between entries, with the pencil line available under a note. This is the
   observation notebook rather than the mounted collection, and it suits a single-track event where
   the day reads as one sitting.

Bind: the pencil line is its own on/off control and ships off by default, so a client can keep the
plates clean.

---

## 6. Atlas — `data-theme="atlas"`

### 1. The story

You are moving through a mapped city on its transit network. Two things are true at once here, and
they are the same system: the sheet, with its survey grid, its contour marks, and its title block;
and the network drawn on top of it, with lettered lines, stations, and a board that tells you what
leaves next. Rooms are stations. Concurrent tracks are lines — Line A, Line B, Line C — each with its
own route mark. Going from one session to the next is a transfer, and the site tells you so in the
plain voice of station signage: where you are, where it is, how long it takes. For an event spread
across a city, this is not a description of the place; it is the map and the timetable you actually
travel with.

### 2. The vocabulary

- **Nameplate** — the map's title block, with the network's name on it. Event name, dates, edition
  line, with contour and coordinate marks at the corner and the `nameplate-mark` motif slot holding
  the survey mark.
- **Map grid** — the faint coordinate grid behind a section. Held below hairline contrast,
  `pointer-events: none`. It is the sheet the network is drawn on.
- **Contour and coordinate marks** — thin survey marks at section corners. They state position. They
  never appear where nothing is being located.
- **Lines** — the concurrent tracks, lettered A, B, C. A line is a route through the day. Each line
  carries a route mark: the letter in the sign face inside a simple survey-drawn shape, always with
  the line's name beside it.
- **Stations** — the rooms and venues. A station has a name, a symbol, and a place on the sheet.
- **Departure board** — the schedule. Time down the left as departures, lines across the head, each
  cell a service. A parent session and its children read as a service and its calling points.
- **Transfer** — moving between sessions. Where two sessions sit on different lines or in different
  venues, the site states the transfer plainly: "Transfer to Line B · Hall 2 · 6 min walk."
- **Wayfinding icons** — the sign set: venue, room, line, transit, step-free access. These carry
  meaning, so they are labelled icons, never motifs and never decorative pills.
- **Folios** — the map key headings: LINES, STATIONS, DAY ONE, GETTING AROUND. Small caps on a
  hairline.
- **Rules** — the graticule. Hairlines throughout, one strong rule per section as the sheet edge.
- **Print view** — the folded pocket map. The board prints as a timetable: lines by letter, stations
  named in full, transfers listed, no controls.
- **Type roles** — heading is the sign face: **Overpass**, drawn from highway sign lettering, which
  is the exact voice a network uses to tell you where to go. Body is the guide text a transit
  authority writes: **Libre Franklin**, the Franklin Gothic lineage that has set public signage and
  timetables for a century. Data and mono both point at the timetable and coordinate hand:
  **Overpass Mono** with tabular figures, for departure times, room codes, walking minutes, and
  distances. A timetable and a coordinate are the same kind of value, so they take the same face.
- **Motifs** — `cartographic` on by default, in precise survey and diagram linework. The slots carry
  route marks, station symbols, and Beck-style schematic line diagrams used as dividers. The drawn
  marks are decorative and `aria-hidden`; the moment a mark identifies a specific line or venue it
  becomes a labelled icon instead.
- **Back issue** — a superseded sheet. A past day drops to the archive tokens and keeps its marks,
  the way an old network map stays readable after the lines change.
- **Dark mode** — the lit map case on the platform at night. Deep slate ground, cool white ink, route
  marks at sign brightness, and the grid and contour tokens retuned so the sheet stays felt rather
  than seen.

### 3. Three signature moments

1. **The nameplate is a title block on a network sheet.** The nameplate sits inside a hairline frame
   with coordinate marks at two corners, the city and date range in the data face below, and a
   schematic line-diagram divider closing it — a short Beck-style run of straight segments and 45°
   turns carrying one mark per line. It states the shape of the event before a word is read. Static,
   ink-only, no animation.
2. **A session reads as a service call.** Each session row carries its line route mark and label on
   the same line as the title, then the station name, the room code, and the departure time in the
   data face at fixed positions
   and fixed widths, so the column of times and rooms runs down the page like a timetable. Child
   sessions list under their parent as calling points. Where the next session needs a move, the
   transfer line states the line, the station, and the walking minutes. Every icon is labelled;
   nothing signals status by colour alone.
3. **Tracing a line is the signature interaction.** The departure board is Atlas's one expressive
   moment: on a user action, one line's column reads as a traced route — its cells come forward and
   its route marks connect down the column while the map grid behind stays put. It starts from a user
   action, finishes under 600ms, animates `transform` and `opacity` only, is readable at every frame,
   and is fully static under `prefers-reduced-motion`. No scroll trigger, no ambient loop, no
   travelling dot.

### 4. Palette words

- **Light:** surveyor's paper, india ink, route red, contour grey, graticule pale blue, key-box
  white, platform slate, benchmark silver.
- **Dark:** deep slate ground, cool white ink, lit route marker, sunken contour grey, felt-grid blue,
  map-case grey, signal-white label, night platform blue.

Bind: lines are told apart by their letter and their name first. A line colour, where a client sets
one, is a second signal and never the only one (§8.1).

### 5. What this story refuses

- **Refuses the decorative map.** No topographic background image, no illustrated cityscape, no
  pin-drop graphics as ornament, no fake network diagram that maps nothing. Every line in a schematic
  divider stands for a real track.
- **Refuses mark inflation.** Coordinate marks appear where a position is stated; route marks appear
  where a line is named. Sprinkled everywhere they become the crosshair-and-bracket tell of a
  generated template.
- **Refuses unlabelled iconography.** A route mark or wayfinding icon without a text label is a
  puzzle, not a sign. Icon plus label, always, in both modes — and a route mark never becomes a
  coloured pill, which the §2.4 list rejects outright.
- **Declined from CJS2026:** the offset stamp shadow and the hand-drawn marginalia. Survey and
  transit drawing is precise by definition; a wobbling pen line or a misregistered ink pass would
  read as a printing fault on a sheet whose whole promise is accuracy.

### 6. The options

**(a) Heading face — the pairing is settled: Overpass, Libre Franklin, Overpass Mono. Three heading
options around it.**

1. **Overpass** *(default)* — the highway sign. It is drawn from road lettering, so route marks,
   station names, and transfer lines all speak in the voice the story needs.
2. **Libre Franklin (extrabold)** — the one-face network. Franklin Gothic set American transit and
   news signage for a century, so running the body face up to heading size keeps the system whole and
   costs nothing extra in the font budget.
3. **Archivo Condensed** — the map label. Sheet space is scarce on a real map, and condensed headings
   pull the page toward the drawn sheet, which suits a dense multi-venue programme.

Body stays Libre Franklin and data stays Overpass Mono under every option. Every heading option must
hold at nameplate size, at `--text-h3`, and inside a route mark, where a single letter must read at a
glance.

**(b) Nameplate treatment — the title block.**

1. **Corner title block** *(default)* — hairline frame, name and dates inside, coordinate marks at
   two corners, city and date range in the data face below, schematic line-diagram divider under it.
   The corner of a survey sheet that carries a network.
2. **Sheet header with a scale line** — name left, dates right, a short ruled scale bar under the
   hairline carrying the event's date span. A scale bar states an extent, which is what a date span
   is, so the device stays honest.
3. **Departure board header** — name set in the sign face on a strong rule, with the next service,
   its line, and its station on one wayfinding line under it. This is the concourse board rather than
   the sheet, for events whose story is movement more than geography. The line updates on load and on
   user action only; it never ticks, animates, or counts down.

**(c) Component variants — the schedule presentation.**

1. **Departure board** *(default)* — time down, lettered lines across, faint map grid behind,
   traced-line signature interaction. The theme's clearest idea.
2. **Line diagram** — one line at a time, drawn as a Beck-style vertical run: stations down the
   column, times in the data face beside them, transfers marked where a track meets another. It is
   the strip map inside a carriage, so it stays in the system and serves a visitor following one
   track all day.
3. **Gazetteer list** — sessions grouped by station rather than by time, each group opening with a
   folio and a labelled venue icon. A gazetteer indexes a map by place, which serves a visitor
   choosing where to stand rather than where to go.

---

## Cross-check against the brief

| Rule | How these stories comply |
|---|---|
| §2.1 nameplate | Every story defines the nameplate as type and rules. No hero, no photo, no image behind a name. |
| §2.1 folios | Every folio is small caps plus a rule. No chip, pill, or badge anywhere. |
| §2.2 motion | One expressive moment per theme, all of it the schedule grid. Everything else is functional motion or static. No scroll trigger, no loop, no ambient. |
| §2.3 motifs | Ink-only, `aria-hidden`, `pointer-events: none`, three per page at most. Atlas wayfinding marks are named as icons with labels, not motifs. |
| §2.4 anti-patterns | Each "What this story refuses" section closes the temptation nearest to that preset. No eyebrows, gradients, glass, pills, colored edges, pulse dots, or zero-padded numbers appear in any moment. Field Guide plate numbers are real sequence data and are called out as such. |
| §3.3 dark mode | Each story names dark mode as its own authored place, with its own palette words. |
| §3.7 scales | Every moment uses existing steps (`--text-nameplate`, `--text-h1`, `--text-folio`) and existing rule tokens. No preset adds a step. |
| §3.8 motifs | Moments use only the four launch slots and the four launch sets. |
| §4 defaults | `botanical` on for Field Guide, `cartographic` on for Atlas, `none` for the other four. |
| §9 settled type | All three pairings are recorded in brief §9: Zine (Karrik, with Bagnard and Avara bundled as alternates), Field Guide (Besley, Vollkorn, IBM Plex Mono), Atlas (Overpass, Libre Franklin, Overpass Mono). Nothing in §9 is open. |
| §3.2 font roles | Every story assigns all four roles. A preset may point `data` and `mono` at one family; Zine, Field Guide, and Atlas do, and Broadsheet runs its agate serif in both. |
| §2.4 Zine stamp | The stamp is built against the six tests in brief §2.4, "Exception two". No other story uses an offset layer. |
| §2.4 eyebrows | No story places text above a title. Folios appear only beside a rule at a section boundary, in a margin, or in a running header. Nameplate metadata sits inside the rule-bounded nameplate block. |
| CJS2026 findings | Tonal grounds, near-black ink, and tint-based elevation apply to all six. The stamp layer and the marginalia are Zine only, with a restrained pencil line in Field Guide. The other four decline both in one stated line. |
| Schedule data model | All six assign a role to nested parent/child sessions, lettered tracks, and the print view. |
| §3.4 / §5.2 options | Every option in part 6 remaps existing tokens only. No option adds a property name, a class, or a component type. The pickers sit in the theme editor beside the preset picker; raw per-token override stays the advanced path. |
| §4 fonts | Every named heading option is self-hosted, Latin-subset `woff2` under SIL OFL or equivalent. No option loads a CDN font or lets a client supply a URL. |

## What the brief settled

Four questions were open when this document was drafted. All four are settled, and the brief
records each one. Nothing here waits on the user.

1. **The type decisions are recorded in brief §9.** Zine is Karrik, with Bagnard and Avara bundled
   as client-selectable heading alternates. Field Guide is Besley, Vollkorn, and IBM Plex Mono.
   Atlas is Overpass, Libre Franklin, and Overpass Mono. The earlier FT88 / Bagnard / Trickster
   audition list is superseded. Verify each licence and each Latin-subset size against the four
   tests in §9 when the faces are bundled in PR2.
2. **The Zine stamp has its written exception.** Brief §2.4, "Exception two: the Zine stamp",
   permits a flat, unblurred, ink-tinted offset layer in Zine only, and lists the six tests it must
   pass. "Shadow decorates nothing" and "no box-behind-box layering" stay intact everywhere else.
   The flat-block variant stays available for a client who wants neither.
3. **The font budget is about 20 to 22 Latin-subset `woff2` families repo-wide** (brief §4). That
   covers the six defaults, every heading option here, the Caveat callout face, and the fixed admin
   pairing. Reuse is deliberate: Spectral serves Broadsheet and Field Guide, Archivo serves Newsroom
   and Atlas, and Source Serif 4 and Libre Franklin are already in the system. A deployed site loads
   only the faces its active preset and picks use.
4. **The option count is bound in brief §4.** Each preset ships two or three heading faces, three
   nameplate treatments, and two or three component variants. The theme editor renders each list as
   a picker, and raw per-mode token override stays the advanced path (§5.2).
