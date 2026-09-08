# Verify read-only browser tools

Issue #114 has two separate acceptance gates. Passing the emulator suite does not prove that a native browser host can discover or invoke the tools.

## Automated browser integration

Run from a checkout with the repository dependencies, Java, and the configured Playwright Chromium installed:

```sh
npm run prepare:functions
npm ci
node --test scripts/webmcp-browser-harness.test.cjs
npm run test:e2e
```

The existing E2E runner starts the Firebase emulators, seeds the synthetic event, and captures console email. The WebMCP spec refuses to change fixtures unless the project name starts with `demo-`, the Auth and Firestore emulator hosts are local, and the email provider is `console`. Do not point it at a client project.

The suite uses an injected `document.modelContext` test double. It exercises the real application, OTP sign-in, Firestore access checks, admin gate, diagnostic endpoints, and route lifecycle. It covers:

- Unsupported-browser content and navigation; public schemas, output bounds, live event identity, and route updates.
- Flag disable and re-enable, anonymous preview isolation, and signed-out and non-admin authorization failures for all six endpoints.
- Invocation of all six admin tools, current-draft validation parity, synthetic sensitive-field redaction, route exit, and sign-out cleanup.

The registry rejects duplicate names and records failures even if application code catches the exception. It does not validate tool inputs or redact tool output. Those behaviors must not be supplied by a test double in place of the application or host.

The suite restores the original feature document, page draft, and synthetic system-error fixture. It does not create a publish-queue job, change provider settings, or send real mail. The test report attaches tool names and lifecycle evidence marked `injected-test-double`; it does not attach diagnostic payloads or credentials.

## Native host acceptance

Use a supported top-level browser host on an operator-controlled synthetic deployment. Do not inject the test double, open the site inside an iframe, or treat ordinary Chromium as proof of host support. Use the host's documented site-tool discovery and invocation controls. Confirm the current API against the [official site-tool documentation](https://learn.chatgpt.com/docs/webmcp).

Keep `webmcpPublic` and `webmcpAdmin` off on client deployments until this check passes. Only the synthetic test deployment may opt in for acceptance. The public static demo already opts in to its read-only set.

| Check | Required evidence |
| --- | --- |
| Public discovery | Exactly `get_event_context`, `inspect_public_page`, `check_public_schedule`, and `get_public_release_context`; no admin name. |
| Public invocation | Invoke all four names. Compare event, page, schedule, and content-source results with the visible site. Navigate without a reload and repeat page inspection. |
| Host schema behavior | Try an unknown input key. Record whether the host rejects the input using the declared empty-object schema. Do not claim the injected suite tests this. |
| Admin discovery | Sign in as the synthetic admin with `webmcpAdmin` enabled. Confirm the six names in the operator guide. Public names must not remain registered in the admin route. |
| Admin invocation | Invoke all six tools. Open a seeded page editor for current-draft validation. Compare results with the related admin screens; record discrepancies. |
| Access and lifecycle | Disable each flag, leave its route, and sign out. Confirm removal. A non-admin must not discover admin tools, and direct diagnostic calls must still enforce server authorization. |
| Privacy | Confirm that outputs omit synthetic private values, user identifiers, secrets, messages, and object paths. Record only pass/fail and the affected tool name in public evidence. |
| Fallback | Repeat ordinary navigation in a browser without site-tool support. No extra setup or tool registration is required. |

Record the result on issue #114 using this template. A skipped or unsupported case is not a pass.

```text
Build commit:
Synthetic origin:
Browser and version:
Native host and version:
Observed API surface:
Date:
Reviewer:
Public discovery and four invocations: PASS / FAIL / NOT RUN
Admin discovery and six invocations: PASS / FAIL / NOT RUN
Host input-schema enforcement: PASS / FAIL / NOT RUN
Flag, route, and sign-out cleanup: PASS / FAIL / NOT RUN
Non-admin rejection and output privacy: PASS / FAIL / NOT RUN
Unsupported-browser fallback: PASS / FAIL / NOT RUN
Discrepancies and linked issues:
Client flags remain off: YES / NO
```

Do not include tokens, account recovery details, raw private results, or real attendee data. A browser version string or a successful injected test run alone is not native acceptance evidence.

## Write-tool decision

This work does not approve write tools. Draft saves, configuration changes, preview actions with side effects, publishing, deployment, deletion, exports, and email remain outside the registered sets. A separate security and product review must define the precise scope, server authorization, validation, audit record, confirmation behavior, and rollback before a write tool can ship.

See the [tool design](../design/webmcp-tools.md) and [operator guide](../operator/webmcp-diagnostics.md) for the current read-only contract.
