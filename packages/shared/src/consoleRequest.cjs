'use strict';

/**
 * The lifecycle of a client console request (`applications/{appId}.status`,
 * ADR 0007). One module so the console functions, the console web app and
 * the provisioning scripts read the same values, groups and words. Before
 * this module the list was copied more than twenty times and had drifted
 * (docs/plans/2026-11-08-state-machine-map/04-console-provisioning.md).
 *
 * Who writes each status:
 *   draft      signup link redeemed (console/functions signupLinks.cjs)
 *   approved   an Owner accepts the agreement (agreementAcceptance.cjs)
 *   building   the provisioner starts (scripts/provision-client.cjs)
 *   ready      the provisioner finishes and emails the Owners
 *   launched   the hosting team marks a ready site as open to the public
 *   withdrawn  an Owner withdraws a draft (applicationStatus.cjs)
 *   declined   the hosting team declines or closes it (reviewDecisions.cjs)
 *   archived   scripts/decommission-client.cjs turns the site off; a restore
 *              puts the earlier status back
 */

const CONSOLE_REQUEST_STATUSES = Object.freeze([
  'draft', 'approved', 'building', 'ready', 'launched', 'withdrawn', 'declined', 'archived',
]);

/** Named sets of statuses. Each one replaces copies that were typed by hand. */
const CONSOLE_REQUEST_GROUPS = Object.freeze({
  /** Closed for good in the console: no reopen. */
  closed: Object.freeze(['withdrawn', 'declined']),
  /** Still being set up by the client; answers and accounts can change. */
  editable: Object.freeze(['draft']),
  /** Accepted, with a build under way or waiting for a retry. */
  building: Object.freeze(['approved', 'building']),
  /** The site exists and answers at its address. */
  built: Object.freeze(['ready', 'launched']),
  /** May be deleted as spam: no build was accepted. */
  spamDeletable: Object.freeze(['draft', 'withdrawn', 'declined']),
});

/**
 * Every move the code makes. `archived` returns to the status saved when it
 * was archived, so it may move to any status that can be archived.
 */
const ARCHIVABLE = Object.freeze(['draft', 'approved', 'building', 'ready', 'launched', 'declined']);
const CONSOLE_REQUEST_TRANSITIONS = Object.freeze({
  draft: Object.freeze(['approved', 'withdrawn', 'declined', 'archived']),
  approved: Object.freeze(['building', 'declined', 'archived']),
  building: Object.freeze(['ready', 'declined', 'archived']),
  ready: Object.freeze(['launched', 'archived']),
  launched: Object.freeze(['archived']),
  withdrawn: Object.freeze(['archived']),
  declined: Object.freeze(['archived']),
  archived: ARCHIVABLE,
});

/** Whether the code may move a request from `from` to `to`. */
function canMoveConsoleRequest(from, to) {
  return Object.hasOwn(CONSOLE_REQUEST_TRANSITIONS, from) && CONSOLE_REQUEST_TRANSITIONS[from].includes(to);
}

/** Whether `status` is in the named group. Unknown groups throw, so a typo fails loudly. */
function inConsoleRequestGroup(group, status) {
  if (!Object.hasOwn(CONSOLE_REQUEST_GROUPS, group)) throw new TypeError(`unknown console request group: ${group}`);
  return CONSOLE_REQUEST_GROUPS[group].includes(status);
}

/** The words the hosting team sees. */
const CONSOLE_REQUEST_OPERATOR_LABELS = Object.freeze({
  draft: 'Draft',
  approved: 'Approved',
  building: 'Building',
  ready: 'Ready',
  launched: 'Launched',
  withdrawn: 'Withdrawn',
  declined: 'Declined',
  archived: 'Archived',
});

/** The words the client sees on the status and organization pages. */
const CONSOLE_REQUEST_CLIENT_LABELS = Object.freeze({
  draft: 'Setup not finished',
  approved: 'We are building your site',
  building: 'We are building your site',
  ready: 'Your site is ready',
  launched: 'Your site is open to the public',
  withdrawn: 'Withdrawn',
  declined: 'We cannot build this site',
  archived: 'Your site is switched off',
});

module.exports = {
  CONSOLE_REQUEST_STATUSES,
  CONSOLE_REQUEST_GROUPS,
  CONSOLE_REQUEST_TRANSITIONS,
  CONSOLE_REQUEST_OPERATOR_LABELS,
  CONSOLE_REQUEST_CLIENT_LABELS,
  canMoveConsoleRequest,
  inConsoleRequestGroup,
};
