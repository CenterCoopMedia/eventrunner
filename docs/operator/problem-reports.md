# Problem reports

The console and each client site's admin panel have a **Report a problem**
button. Signed-in people use it to describe a problem; the report also carries
the page address (without its query), the build id when one is set, and the
browser's last 50 warnings and errors, with credentials and email addresses
removed.

## Path

1. The browser posts to the console function `reportProblem`
   (`/api/reportProblem` on the console host). A client admin panel calls it
   cross-origin.
2. The function checks the Firebase ID token. A console token is checked with
   revocation. A client token is accepted only for a project this console
   built (a request that is building, ready or launched) or one listed in
   `CONSOLE_REPORT_PROJECTS`. The email must be verified. Each person gets ten
   reports an hour.
3. The function forwards the report to the operator's triage service at
   `CONSOLE_REPORT_INTAKE_URL`. Nothing is stored in the console.
4. The triage service sends the operator a Telegram card with **File**,
   **File + fix** and **Ignore**. File opens a GitHub issue in this repository
   without the reporter's email or browser messages. File + fix also starts a
   fix session that opens a pull request for review. Nothing merges or deploys
   on its own.

## Settings

Console project only:

- `CONSOLE_REPORT_INTAKE_URL`: the triage service's intake address.
- `CONSOLE_REPORT_PROJECTS`: optional, comma-separated client project ids for
  sites from before the console.
- Secrets `CONSOLE_REPORT_INTAKE_SECRET`, `CONSOLE_REPORT_ACCESS_ID` and
  `CONSOLE_REPORT_ACCESS_SECRET`: the intake key and the access-gate service
  token. The function deploy needs all three to exist.

Until they are set, the form answers "Reports are not switched on yet."
A client site can point at another console with `VITE_CONSOLE_ORIGIN`.
