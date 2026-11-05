# Operator actions and feedback

Issue [#695](https://github.com/CenterCoopMedia/eventrunner/issues/695).

## Direction

The November 5 operator review identified two problems: familiar utility
controls occupy too much room, and an action can appear unresponsive when its
result lands above the current viewport. The requested direction is compact,
recognizable icons, local and durable outcomes, clear pending states, and
predictable keyboard recovery.

This extends the earlier desk guidance for utility controls. Section names,
primary workflow actions, and consequential confirmations retain the words
needed to choose them. Collapse, expand, close, help, view site, and sign out
use familiar symbols with accessible names and visible hints on hover or
keyboard focus. The destinations and their order stay intact.

The rail becomes 64 pixels wide when collapsed. Its control remains the same
DOM button in both states, keeps keyboard focus, and still remembers the
operator's preference. The expanded control sits beside the event name. The
phone disclosure shows the current section beside a menu or close symbol.

## Interaction rules

- A result belongs beside its action, or in the same sticky action area.
  Save, publish, delete, and refresh are distinct outcomes. A failed refresh
  must never invite the operator to repeat an already successful write.
- Pending operations identify the action in progress and prevent conflicting
  changes. A late response must not replace a newer draft or preview.
- Destructive confirmation moves focus to its consequence. Backing out or
  pressing Escape returns focus to the original control. Pending deletion
  keeps the confirmation open.
- Dialogs use native modality. Tab stays inside the top dialog, Escape steps
  out one level, and closing returns focus to a connected control. When a
  deleted file removes that control, the library search provides a useful
  fallback.
- X, Escape, and Cancel obey the same pending-write guard. A failed upload
  leaves the selected file and description available for retry.
- A failed media usage check is an explicit error with a retry. It does not
  remain a loading state or claim that an unchecked file is unused.

## Motion

Motion explains activity without delaying the action. A restrained spinner
identifies an in-flight upload, metadata save, or usage check. A short opacity
fade introduces a utility hint. Both are conditional on the reader allowing
motion. Navigation, layout, focus changes, and destructive confirmation remain
immediate. The static label always communicates the same state.

## Verification and evidence

GitHub-hosted unit checks cover naming, keyboard hints, native modal requests,
focus boundaries and return, pending dismissal, delayed upload and save
responses, usage-check recovery, and sign-out protection with an icon control.
Hosted browser checks exercise the real navigation at desktop and 320-pixel
widths, native media modality, reduced motion, and enlarged text. Screenshots
come from synthetic emulator data and are attached to the review from a
separate evidence branch so adding images does not replace a tested UI head.

Related passes in #695 address editor rows, long forms, Live updates,
imports, reminders, settings, and the client and hosting console. Each branch
starts from main and opens ready for review so hosted checks and connector
review begin together.
