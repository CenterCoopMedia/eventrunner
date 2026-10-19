# External pitch form evidence

Desktop is 1280 × 900. Phone is 390 × 844. Images use the synthetic E2E Test Summit fixture and a reserved example form address.

The call is open with `externalFormUrl` set. The home page lead shows **Pitch a session** after the fixture's own actions. `/pitch` shows the call status, the deadline and one **Open the pitch form** link; the site's own form and sign-in are hidden.

There are no before images. On the base commit, the home page had no pitch action, and an external form mode did not exist.

`e2e/session-pitch-ui.spec.js` makes these captures when `PITCH_EVIDENCE_DIR` is set. The same test checks both widths for horizontal overflow and checks that a closed call removes both links. Chromium ran without its sandbox, because this capture container runs as root.
