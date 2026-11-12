# Set a client's email addresses

Host operators use `scripts/set-client-email.cjs` to set the From address and
the mailing address in email footers after a site is built. Client admins,
including client operators, continue to see these fields as read-only.
Custom domains use their own setup process.

Use a Firebase IAM identity that can read and write the selected project's
`config/event` and create an `admin_logs` row. The script uses the existing
service-account or application-default credential route in
`scripts/lib/firebase-init.cjs`. Do not put credentials in command arguments.
`--actor` names the host operator for the audit; Firebase IAM authorizes the
write.

Prepare a UTF-8 plain-text file with the organization's actual mailing address,
one line per address line. The script escapes the text and stores line breaks
as HTML breaks. It refuses an empty file, a `[Replace` placeholder, invalid
UTF-8, control characters and files larger than 8 KiB.

In the host operator's shell, set `EVENT_FIREBASE_PROJECT_ID` to the intended
client project. Set `CLIENT_EMAIL_ACTOR` to the operator's email,
`CLIENT_EMAIL_ADDRESS_FILE` to the address file and `CLIENT_SENDER_EMAIL` to
the requested From address. Check those inputs against the client request.
Verify a new sender domain with the email provider before changing the From
address. Run from the repository root.

Preview the change:

```bash
node scripts/set-client-email.cjs --actor "$CLIENT_EMAIL_ACTOR" --address-file "$CLIENT_EMAIL_ADDRESS_FILE" --sender-email "$CLIENT_SENDER_EMAIL" --dry-run
```

The preview reads the named project, lists the fields that would change and
writes nothing. Check the project name. Apply the reviewed inputs:

```bash
node scripts/set-client-email.cjs --actor "$CLIENT_EMAIL_ACTOR" --address-file "$CLIENT_EMAIL_ADDRESS_FILE" --sender-email "$CLIENT_SENDER_EMAIL"
```

To change only one setting, omit the other setting's flag. A real change and
its `updateClientEmailSettings` audit row commit together. The row names the
operator, credential mode and changed fields; it does not copy the address.
Unchanged settings create no audit row. A sender email change clears its saved
domain-verification record. Run the existing
[sender-domain verification procedure](../DEPLOY_RUNBOOK.md) to record the
new verification. An address-only change preserves that record.

Check the client's **Set up your event → Hosting status → Email mailing
address** after the Functions and web changes are deployed. Its status is
advisory. The launch gate still has seven checks. Existing announcement and
reminder send guards refuse a missing or placeholder mailing address.
