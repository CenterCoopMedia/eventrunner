### Changed

- After an operator publishes a ticket resource policy, adding a bookmark,
  setting a reaction or writing a session note requires a ticket grant that
  covers that session. Reactions also need the interactions grant. Removing a
  bookmark or reaction keeps the existing attendee check. Speakers, admin-approved
  accounts and bootstrap staff keep full access. Deployments with no published
  policy keep current full-event access.
- A refused note save says access is updating or the ticket does not include
  the session, and keeps the typed text. Importing browser saves keeps sessions
  the ticket does not include and continues with the others.
