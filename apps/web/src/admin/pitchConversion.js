// Helpers for turning an accepted pitch into drafts (ADR 0008 §3).

/** "Mary Ann Smith" → ["Mary Ann", "Smith"]: a start for staff to check. */
export function splitName(name) {
  const words = typeof name === 'string' ? name.trim().split(/\s+/).filter(Boolean) : [];
  if (words.length < 2) return [words[0] || '', ''];
  return [words.slice(0, -1).join(' '), words[words.length - 1]];
}

/** The line after "Create reviewed drafts": who was invited, and who was not. */
export function conversionMessage(response) {
  const invites = Array.isArray(response?.invites) ? response.invites : [];
  const sent = invites.filter((invite) => invite.sent).map((invite) => invite.email);
  const failed = invites.filter((invite) => !invite.sent);
  const parts = ['Private drafts created. Review the session and each speaker before publication.'];
  if (sent.length) parts.push(`Invite sent to ${sent.join(', ')}.`);
  if (failed.length) parts.push(`${failed.length === 1 ? 'One invite was' : `${failed.length} invites were`} not sent. Resend from the speaker's page.`);
  if (!invites.length) parts.push('No invite or email was sent.');
  return parts.join(' ');
}
