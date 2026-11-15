### Changed

- After a ticket resource policy is published, a refused bookmark or reaction
  states "Access updating" or "Your ticket does not include this session"
  beside the control, in place of an error toast. A refused post, reply or
  report says the same for the attendee feed and keeps the typed text. The feed
  and thread say the ticket does not include the feed or access is updating, and
  reopen when the grant allows it. An unsent post or reply comes back for the
  same reader when the feed reopens; it is kept in memory only.
- A refused note keeps its text in the browser across pages. The next visit
  shows it as unsaved text with "Save now" and "Discard unsaved text"; it is
  never saved on its own. Signing out removes it.
