### Changed

- After an operator publishes a ticket resource policy, attendees-only
  directory profiles and attendees-only shared schedules need the directory
  grant (#1004), and attendee live updates need the attendee updates grant
  (#1005). Public profiles, public schedules and live updates for everyone
  stay readable. Speakers, admin-approved accounts and bootstrap staff keep
  full access. Deployments with no published policy keep current access.
- The attendee directory and the live updates card fall back to the public
  rows when the ticket does not include those resources, instead of failing
  (#1004, #1005).
