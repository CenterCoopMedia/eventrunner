# Trademark screen — "Run of Show"

**Date:** 2026-08-26
**Status:** Preliminary research screen complete. Not legal advice — see §5.
**Tracks:** [Issue #2](https://github.com/CenterCoopMedia/run-of-show/issues/2), milestone M1.
**Prior work in this issue:** `runofshow.net` purchased and registered (Cloudflare, jamditis@gmail).
GitHub org decided — staying under the existing paid Center for Cooperative Media organization.
This document closes the remaining two items: the knockout trademark screen and the npm
availability check.

---

## 1. Methodology

This is a knockout screen, not a clearance opinion: a quick pass over the most visible federal,
common-law, and package-registry sources to catch an obvious blocking conflict before more effort
goes into the name. It is the kind of check a non-lawyer can do in an afternoon, and it is not a
substitute for a paid clearance search or a filed application's own examination.

Sources checked:

- USPTO Trademark Search (`tmsearch.uspto.gov`) and Trademark Status & Document Retrieval
  (`tsdr.uspto.gov`) for direct hits on "RUN OF SHOW" and close variants.
- Web search for common-law use of "Run of Show" as a product or company name in event
  technology and adjacent fields (per the issue's note that Shoflo, Rundown Studio, and Eventify
  sell run-of-show *features* under other brand names).
- npm registry (`registry.npmjs.org`) for the package name and both plausible scopes.
- A light pass for EUIPO/international registrations — no hits surfaced easily; not exhaustively
  searched (see §5).

## 2. USPTO findings — this is the one that matters

**There is a live, registered U.S. federal trademark for "RUN OF SHOW."**

| Field | Value |
|---|---|
| Mark | RUN OF SHOW (standard character mark — no font, size, or color claimed) |
| Registration No. | 6,604,229 |
| Serial No. | 90327230 |
| Status | **Live / registered** |
| Filed | November 18, 2020 |
| Registered | December 28, 2021 |
| Owner | Run of Show, a Delaware corporation, 300 E 34th St, 34J, New York, NY 10012 |
| Class | International Class 042 (primary) |
| Goods/services | "Time sensitive task management and communication services, namely, providing a web hosting platform featuring a detailed schedule of the item-by-item sequence of steps adjustable in real-time for events" |

This is not a tangential hit. The registered goods/services description — a hosted platform for
managing the detailed, real-time-adjustable schedule of an event — sits very close to what this
project is. The mark is registered in standard characters, meaning the registration is not
limited to a particular logo or stylization; it covers the words themselves in Class 42 (software
and hosted-service marks).

Corroborating a live product behind the registration: an app called "Run of Show" is listed on
the Apple App Store (id1602822977), described as mobile/web software for task scheduling and
communication during the execution phase of live events and productions — a direct functional
match to the registration's recitation of goods.

Separately, a company called "Run of Show, LLC" (Denver, CO, founded 2022, `runofshowco.com`)
operates as an experiential-marketing/event-production agency under the same name. It is unclear
from public sources whether this is the same entity as the Delaware corporation on the
registration or an unrelated company that adopted the same name later — either way it is a second
active commercial user of "Run of Show" in the events space, which reinforces the crowding problem
rather than resolving it.

**This is the headline finding of this screen and changes the risk picture from what the original
issue assumed.** The issue's working assumption was "generic industry term, low infringement
risk." The term is generic/descriptive as used inside the industry (a run of show is a standard
production document), but a live federal registration exists for essentially this product
category under this exact name. Genericness is a defense to *registrability* and to some
infringement claims, but it does not make an existing registration disappear, and "the term is
generic in the industry" is a harder argument to win when someone else has already gotten it
registered for the adjacent service.

## 3. Common-law findings

- **Shoflo** (now Lasso Rundown after acquisition) and **Rundown Studio** are both live,
  actively-marketed run-of-show/rundown products, confirming the issue's note — neither uses "Run
  of Show" as a product name, both use "rundown."
- **Eventify** sells automated run-of-show template generation as a feature within a broader
  event-management platform, also not under a "Run of Show" brand name.
- No new competing *product* name turned up beyond what the issue already flagged, with the
  exception of the two "Run of Show" companies described in §2, which the original issue's survey
  of Shoflo/Rundown Studio/Eventify did not surface because none of those three is named "Run of
  Show."

## 4. npm availability

Checked against the live npm registry on 2026-08-26 (a 404 from `registry.npmjs.org` means the
name is unclaimed; a scope lookup returning `"Scope not found"` means the scope is unclaimed):

| Name | Result |
|---|---|
| `run-of-show` (package) | 404 — unclaimed |
| `runofshow` (package) | 404 — unclaimed |
| `run_of_show` (package) | 404 — unclaimed |
| `@runofshow` (scope) | unclaimed |
| `@run-of-show` (scope) | unclaimed |

The npm package name and both natural scopes are available. This is a soft reservation, not a
guarantee — nothing stops a third party from publishing under any of these names before this
project does. If the codebase is going to publish `packages/shared` or any other package publicly,
claiming `run-of-show` (or a scope) with an empty placeholder release is cheap insurance and can
be done independently of the trademark question below.

## 5. Risk assessment

- **Genericness / descriptiveness:** "Run of show" is standard industry vocabulary for the
  document that sequences an event, which argues for a weak, narrow mark and makes a pure
  word-mark hard to enforce broadly. That analysis is unchanged by this screen.
- **Likelihood of confusion:** elevated by the Reg. No. 6,604,229 finding, not low as originally
  assumed. Both the registrant's goods/services description and the associated App Store product
  describe essentially the same category of thing this project is building: a hosted platform for
  managing an event's real-time schedule. Same term, same field, same function is the profile of a
  likely-confusion problem, not a knockout-clear one.
- **Geographic/use overlap:** the registrant is New York-based; this project is also
  Northeast-U.S.-based (Montclair State / CCM, New Jersey) with a nationally-reachable web
  platform. National reach on both sides removes the "different market" mitigation that sometimes
  softens a same-name conflict.
- **What doesn't change:** the domain (`runofshow.net`) and the GitHub org/repo name are already
  settled and are lower-stakes than the *marketed product name* — a domain or repo slug is not by
  itself a trademark use in the way a product name on a pricing page or app store listing is.

## 6. Recommendation

1. **Do not treat "combined name+logo mark" as a way around this finding.** The issue proposed
   that strategy on the assumption of a merely descriptive term with no direct registered
   competitor. A live word-mark registration in the same class for the same function is a
   different, more serious problem than descriptiveness — a logo does not cure a likelihood-of-
   confusion issue against an identical word mark used for the same service.
2. **This project should not launch its public-facing product name as "Run of Show" without a
   licensed trademark attorney reviewing Reg. No. 6,604,229 specifically** and advising on
   conflict risk, before any public launch, press, or paid marketing under that name. This is the
   one item in this screen that should not be closed on a non-lawyer's read.
3. **In parallel, name the fallback options** so the decision isn't blocked entirely on counsel's
   calendar: e.g. "Show Runner," "Runsheet," "Rundown [X]," or a coined/compound name that avoids
   the exact registered phrase, keeping in mind the codebase already keeps the working name out of
   code identifiers (spec §1.2) specifically so a rename stays cheap.
4. **Claim the npm name/scope now regardless of the trademark outcome** — it's free, unclaimed,
   and independent of what the product is ultimately branded (§4).
5. Domain and GitHub org decisions already made in this issue's earlier comments do not need to be
   revisited by this finding; they are low-cost to abandon or repoint if the name changes.

## 7. Caveats

This is a preliminary, non-exhaustive knockout screen conducted by searching public trademark and
package-registry databases. It is **not legal advice** and does not substitute for a formal
clearance search or an opinion from a trademark attorney. It did not include: a paid comprehensive
clearance search (e.g. through a legal clearance vendor), a full state trademark registry sweep,
a common-law search beyond web search results, or a complete international/EUIPO search. Given the
direct federal registration found in §2, formal counsel review is no longer merely an optional
follow-up for polish — it is the recommended next action before this project markets a product
under the name "Run of Show."

---

## 8. Candidate replacement names

Follow-up screen, run 2026-08-26 after §2's finding. Same knockout-screen methodology (§1), applied
to six candidates: the three names floated (Showrunner, Eventrunner, Runner) plus close variants
worth checking alongside them (Show Runner as a two-word spacing variant of Showrunner — spacing
doesn't change trademark or common-law exposure, so it isn't broken out separately below — plus
Runsheet and Rundown). Checked against USPTO/Trademarkia for registered and pending marks, web
search for common-law product use in event tech, RDAP (`rdap.org/domain/<name>.<tld>`, 200 =
registered/taken, 404 = available) for `.com`/`.net`/`.org`/`.events`, and the npm registry
(`registry.npmjs.org`, 404 = package name unclaimed; `-/org/<scope>/package` returning
`"Scope not found"` = scope unclaimed, an empty `{}` or a populated object = scope already claimed).

### Showrunner (and "Show Runner")

**USPTO:** crowded and directly conflicting. A live registration, Serial 88691559, owned by
Showrunner, Inc., Class 009, for an integrated video-production system (camera, microphone,
cables, tripod, computer, monitor, switching/signal hardware) — production-adjacent goods, not
identical to a schedule-management platform but close enough to invite an office action or
opposition. A second live registration, Serial 88826640 (True Fitness Technology, Inc., Class 028,
exercise-equipment consoles), is irrelevant by field. Several more SHOWRUNNER-formative marks are
dead/abandoned (Showrunner Ai LLC's "SHOWRUNNER AI" in Class 042 marketplace services; Omelet
LLC's "BRAND SHOWRUNNER"; "SHOWRUNNER PRODUCTIONS") — abandoned marks don't block registration but
show the term has been fought over repeatedly. **Common-law:** "showrunner" is also a live, highly
visible product name right now — Fable Studio's Amazon-backed AI TV-generation platform launched
under this exact name in 2025/2026 with major press coverage, plus "Showrunner Industries Inc."
selling adjacent production-software products (WritersRoom Pro, PodcastStudio Pro). It is also
plain English industry vocabulary for the person who runs a TV production, which independently
caps how strong a mark it could ever be. **Domains:** all four of `.com`/`.net`/`.org`/`.events`
are registered to someone else. **npm:** the `showrunner` package name is taken (an active desktop
screen-recording app, last published 2026-02) and the `@showrunner` npm org scope is already
claimed (returns an empty package list, meaning someone owns the org even though they haven't
published under it yet). **Verdict: worst of the six.** A live Class 9 registration in a
production-adjacent field, a simultaneous high-profile common-law user, zero available domains,
and a claimed npm scope make this the highest-risk, lowest-availability candidate — drop it.

### Eventrunner (and "EventRunner")

**USPTO:** no registrations or applications found for "EVENTRUNNER" or "EVENT RUNNER" in any
class — the cleanest federal result of the six. **Common-law:** crowded despite the clean
trademark register. At least four active event-management products already use this exact name or
a spacing variant of it: `eventrunner.pro` (agency event management — venue sourcing, vendor
tracking, budgets), `eventrunner.app` (event planning/execution tool), "EventRunner by Event Tech
Solutions" (registration platform, since ~2016), and "Event Runner Pro" (production-runner/crew
logistics management) — plus a "The Event Runner" event-management service. None of them appear to
hold a federal registration, which is exactly why the trademark register looks clean; it does not
mean the name is actually open. This is real common-law crowding in the identical field this
project is in. **Domains:** `.com` and `.net` are taken; `.org` and `.events` are both available.
**npm:** `eventrunner` and `event-runner` package names are unclaimed, and the `@eventrunner` /
`@event-runner` scopes are both unclaimed. **Verdict:** clean on paper (register and package
namespace) but the common-law crowding in the exact same product category is a real problem —
four+ existing "EventRunner"-family products in event management/production is enough live
confusion risk that a lawyer would likely still flag it, even without a registration to point to.

### Runner

**USPTO:** no standalone "RUNNER" word mark found live in Classes 9, 41, or 42 relevant to
software/event services in this screen's search depth — hits were all compound marks ("Runner
Music Group" for live music/broadcast services, an abandoned "Runner (Xiamen) Corp." filing for
unrelated design/testing services). **Common-law:** the word is generic English and used
everywhere (delivery apps, running-shoe brands, "event runner" as a literal event-crew job title),
which cuts two ways — hard to find one specific blocking competitor, but also close to
unregistrable as a standalone mark for anything in this field: it's the kind of word an examiner
would very likely refuse as merely descriptive of a role or function without a distinctive
second element. **Domains:** all four TLDs taken (unsurprising for a common dictionary word).
**npm:** `runner` package name is taken (an actively maintained task-runner CLI) and the `@runner`
scope is heavily claimed — a dozen-plus packages already live under it. **Verdict:** no direct
registered-mark conflict, but the combination of a fully generic word, zero domain availability,
and a heavily-used npm scope makes it impractical as a standalone name regardless of trademark
risk. Would need a distinguishing second word to be usable at all, at which point it stops being
"Runner" and becomes a different candidate to re-screen.

### Runsheet

**USPTO:** no registrations or applications found for "RUNSHEET" or "RUN SHEET" in any class.
**Common-law:** one direct, active, same-field competitor: `runsheet.pro`, marketed explicitly as
"a real runsheet platform" for live-event production teams — real-time collaborative scheduling,
crew coordination, versioned changes. This is functionally the closest existing product to what
this project does of any candidate screened (including the original "Run of Show" registrant).
**Domains:** `.com`, `.net`, `.org`, and `.events` are all taken (consistent with the active
`runsheet.pro` product owning at least some of the namespace). **npm:** the `runsheet` package name
is taken (an unrelated TypeScript pipeline library) but the `@runsheet` scope is unclaimed.
**Verdict:** clean federal register, but a live, same-field, same-function competitor already
trading under this exact name is the single sharpest common-law conflict in this set — pick this
and expect to eventually collide with `runsheet.pro`, registration or not.

### Rundown

**USPTO:** no standalone "RUNDOWN" mark found live in the relevant classes — all hits were
compound marks in unrelated fields (RIG RUNDOWN / DRUM RUNDOWN for musical-instrument streaming,
THE RUNDOWN for horse-racing tracking software, RPG RUNDOWN for social-media posting tools).
**Common-law:** "rundown" is the direct industry synonym this project's own issue already flagged
— Shoflo rebranded to "Lasso Rundown" after acquisition, and it's standard broadcast/production
vocabulary for the same document a run of show is (which is also why nobody in this field can
easily claim it as distinctive). **Domains:** all four TLDs taken. **npm:** the `rundown` package
name is taken (an unrelated dev-tooling package) but the `@rundown` scope, while technically
claimed, has only one unrelated package under it. **Verdict:** clean federal register, generic
industry synonym (same weak-mark problem the original "Run of Show" screen flagged, not solved by
switching to a synonym), no domains available. Usable only as part of a longer, more distinctive
name — "Rundown" alone repeats this project's original problem under a different word.

### Ranking

| Rank | Candidate | USPTO risk | Common-law crowding | Domains available | npm available | Overall |
|---|---|---|---|---|---|---|
| 1 | **Eventrunner** | Clean | Moderate (4+ similarly-named products, none registered) | `.org`, `.events` | package + both scopes | Best balance — clean register, real but non-blocking common-law noise, actual domain/npm room |
| 2 | **Rundown** | Clean | High (direct industry synonym; Shoflo's own rebrand) | none | scope only (npm-package name is taken) | Clean legally but too generic/weak alone and no domain runway |
| 3 | **Runsheet** | Clean | High (one direct, active, same-function competitor: runsheet.pro) | none | scope only | Clean register can't offset a live identical-field competitor |
| 4 | **Runner** | Low (no direct hit, but likely unregistrable alone) | Very high (generic word) | none | none | Not viable standalone; would need a distinctive second word |
| 5 | **Showrunner / Show Runner** | High (live Class 9 registration in a production-adjacent field) | Very high (major concurrent AI-TV product launch) | none | scope claimed | Worst of the six — drop |

**Recommendation:** lead with **Eventrunner** for a deeper look — clean federal register, no npm
or `.org`/`.events` domain blockers, and its common-law crowding is diffuse (several small
products, no dominant player, none registered) rather than one direct head-to-head competitor.
Keep **Rundown** or **Runsheet** as fallbacks only if paired with a distinguishing second word
(e.g. a coined or compound form), since both are otherwise clean on the register but weak or
directly contested as standalone names. This is still a non-lawyer knockout screen (§7 caveats
apply equally here) — before committing to Eventrunner or any other candidate, get it in front of
the same trademark counsel review recommended in §6.
