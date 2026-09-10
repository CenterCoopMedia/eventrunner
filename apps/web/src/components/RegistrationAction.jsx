// The configured registration action (M7 issue 8): the one control that
// sends a reader to wherever the event actually takes registrations.
//
// IT IS CONFIGURATION, NOT CONTENT. The destination is
// `config/event.registration.externalUrl` — the field the ticket provider
// already reads for its own registration email
// (functions/src/ticketing/providers/) — so the link in that email and the
// control on the page are one value and cannot drift apart. The
// wording is `registration.actionLabel` beside it, and where a client has
// not written one the stated default below stands in, because a control
// with a blank face is worse than a plainly-worded one.
//
// AN UNSET DESTINATION RENDERS NOTHING, ANYWHERE. A provider that sells no
// tickets, and a client who has not been handed a link yet, are the ordinary
// starting state of a deployment, not an error — and the site's answer to
// them is silence. `docs/interface-guidelines.md` rejects a signup slot with
// no backend behind it, and a button that goes somewhere useless is worse
// than no button: a reader spends a click to learn that nothing is there.
// So this component returns null rather than drawing a disabled control, a
// placeholder, or a link to the site's own home page.
//
// The schema already refuses anything but an https destination
// (packages/shared/src/config/schema.cjs), but a runtime config/event doc is
// unvalidated Firestore data (spec §2.4 fail-soft overlay) and can hold
// whatever was written before that rule existed, so the same check runs
// again here. A destination this file cannot vouch for renders no control
// at all — the same silence an unset one gets.
//
// ONE COMPONENT, TWO PLACEMENTS, so the two never disagree about where the
// event takes registrations:
//
//   lead     the filled action in the home page's opening section, beside
//            whatever actions an editor has written into the hero.
//   header   the same action in the shell, in the quiet register the
//            header's other end controls use, after the navigation, so
//            mounting it is a single self-closing tag and no other control
//            in that row has to move.
//
// THE HEADER PLACEMENT KEEPS ITS OWN DISTANCE FROM THE NAVIGATION. Three of
// the four header treatments stack their children, where this is a row of
// its own and the question does not arise. `minimal` (Header.jsx) puts the
// identity, the navigation and this in ONE flex row, and the navigation's
// last item is where the shell's sign-in control goes — so without a
// separation of its own, a register control would sit one gap away from a
// sign-in link and the two would read as one pair of controls. `ms-auto`
// answers that in the row and does nothing at all in the three stacked
// treatments, where the element is already full width.
//
// WHICH DESTINATION COUNTS IS NOT THIS FILE'S OPINION. `config/event` is
// validated at the save, but a runtime document is unvalidated Firestore
// data that may predate the rule, so the destination is read through
// `resolveRegistrationAction` (shared/registration) — the one reader the
// registration email uses too. A renderer with its own idea of what counts
// as a safe destination is how a value that saved cleanly ends up refused
// on the page, or worse, put in front of a reader in an email after the
// page refused it.
import { resolveRegistrationAction } from 'shared/registration';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { primaryActionClass, quietActionClass } from './controlClasses.js';
import ExternalLink from './ExternalLink.jsx';

/**
 * What the control says where a client has not written their own wording.
 *
 * Stated here rather than in the shared reader because the wording around
 * the action is not the same sentence everywhere: a page draws a button, an
 * email writes a line of its own. What the surfaces must agree on is where
 * the action goes.
 */
export const DEFAULT_REGISTRATION_LABEL = 'Register';

/**
 * The configured registration action as this page draws it, or null when
 * there is nothing to send a reader to.
 *
 * Exported because the home lead has to know whether the action row has
 * anything in it at all before it draws the row — an empty row is a stray
 * gap down the page.
 *
 * @param {object|null|undefined} eventConfig config/event, as the context serves it
 * @returns {{ label: string, url: string } | null}
 */
export function resolveRegistrationLink(eventConfig) {
  const action = resolveRegistrationAction(eventConfig);
  if (!action) return null;
  return { label: action.label ?? DEFAULT_REGISTRATION_LABEL, url: action.url };
}

/**
 * @param {{ placement?: 'lead' | 'header' }} props
 */
export default function RegistrationAction({ placement = 'lead' }) {
  const { eventConfig } = useEventConfig();
  const action = resolveRegistrationLink(eventConfig);
  if (!action) return null;

  // A new tab, with the opener relationship severed and the referrer
  // withheld, the same way every other outbound link on this site opens
  // (CtaBlock.jsx): the registration form belongs to somebody else, and a
  // reader partway through one should not lose the event's own page.
  const link = (
    <ExternalLink
      href={action.url}
      className={placement === 'header' ? quietActionClass : primaryActionClass}
    >
      {action.label}
    </ExternalLink>
  );

  if (placement !== 'header') return link;

  return <div className="ms-auto flex justify-end py-2xs">{link}</div>;
}
