### Security

- The attendee site reloads when a signed-in account signs out or another
  account replaces it in the same tab. The next account then starts with an
  empty Firestore cache and cannot see rows that were read for the previous
  account, online or offline (#1017).
