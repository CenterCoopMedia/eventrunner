# Admin schedule workflow

The schedule workspace lets an operator move from event structure to session detail without editing raw records. It uses the existing admin identity and record-state language.

## Venue references

A place has a stable id, a reader-facing name, and an optional floor. The id is a reference key. Renaming the place does not change it.

- Generate an id from the first name only as a starting value. Show it as an editable data field before the first save.
- After the place is referenced, keep its id stable. A name or floor change must not break sessions or movements.
- Require a nonempty id made from lowercase letters, digits, and single hyphens. Refuse duplicate ids and empty names before save.
- Do not remove a place that a live or draft session references. Show the sessions that must move first.
- When an unused place is removed, remove unsaved movement rows that name it and explain that effect before save.

A movement is one recorded, one-way route from one place to another.

- `from` and `to` must be different defined place ids.
- `walkingMinutes` is a whole number from 0 to 120. Zero means across the corridor and is valid.
- `accessibleRoute` is optional reader-facing guidance, not a second duration.
- Do not infer a reverse route, chain routes, or estimate missing times.
- Refuse a duplicate `from` and `to` pair.

## Session register

Group sessions by event day. Order top-level sessions by start time and title. Put each child directly below its parent, even when an unrelated top-level session starts between the two times. A child is indented once and never becomes a second tree level.

Each row shows the title, time, track, place, and record state in text. Do not encode state only with color or turn metadata into chips. Preserve the existing admin list rhythm and proof-row treatment.

## Session editor

The main fields follow the order in which an operator answers them:

1. Title and public description.
2. Day, start, and end.
3. Track, place, and free-text location.
4. Optional parent session.
5. Existing speaker, material, and other supported fields.

Track and place selects read the current event configuration. The parent select contains same-day top-level sessions only and excludes the current session. A child can leave track unset to inherit its parent. Keep the free-text location independent from `placeId`.

Save creates or updates the draft revision. Preview and publish use the existing CMS boundaries. Publishing a child includes its draft-only parent in the same publish set, or explains why the action is unavailable until the parent is live. Show server validation next to the field when possible and retain the operator's unsaved values after a rejected save.

## Interaction rules

- Use one clear primary action for the current step.
- Disable an action only while its request is active or its required fields are invalid.
- Announce successful saves and publishes through the existing notice pattern.
- Confirm destructive actions with the record name and the effect on references.
- After a cancelled confirmation, restore focus to the initiating control. After a row is removed, move focus to the next row action, the previous row action, the add control, or the section heading, in that order.
- Keep keyboard order aligned with the visible reading order.
