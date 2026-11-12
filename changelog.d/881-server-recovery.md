### Changed

- Give server failures a safe next action when none was provided. Existing send, payment and publish recovery instructions remain unchanged (#881).
- Show the server's recovery instruction in the announcement composer, including continuing a partial send, and keep the email error heading accurate when an action stops part way (#881).
