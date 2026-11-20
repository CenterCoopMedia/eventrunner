// One destination in the header and home lead. The public catalog selects
// native ticketing; other providers keep the configured external action.
import { PublicLink as Link } from './PublicLink.jsx';
import { useRegistrationLink } from '../lib/useRegistrationLink.js';
import { primaryActionClass, quietActionClass, ticketButtonClass } from './controlClasses.js';
import ExternalLink from './ExternalLink.jsx';

export { DEFAULT_REGISTRATION_LABEL, resolveRegistrationLink, useRegistrationLink } from '../lib/useRegistrationLink.js';

export function RegistrationLink({ action, placement = 'lead' }) {
  if (!action) return null;
  const link = action.native
    ? <Link to={action.url} className={ticketButtonClass(action.style)}>{action.label}</Link>
    : <ExternalLink href={action.url} className={placement === 'header' ? quietActionClass : primaryActionClass}>{action.label}</ExternalLink>;
  return placement === 'header'
    ? <div className="ms-auto flex min-w-0 justify-end py-2xs">{link}</div>
    : link;
}

export default function RegistrationAction({ placement = 'lead' }) {
  const action = useRegistrationLink();
  return <RegistrationLink action={action} placement={placement} />;
}
