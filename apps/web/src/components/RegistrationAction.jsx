// One destination in the header and home lead. The public catalog selects
// native ticketing; other providers keep the configured external action.
import { Link } from 'react-router-dom';
import { useRegistrationLink } from '../lib/useRegistrationLink.js';
import { primaryActionClass, quietActionClass } from './controlClasses.js';
import ExternalLink from './ExternalLink.jsx';

export { DEFAULT_REGISTRATION_LABEL, resolveRegistrationLink, useRegistrationLink } from '../lib/useRegistrationLink.js';

export function RegistrationLink({ action, placement = 'lead' }) {
  if (!action) return null;
  const className = placement === 'header' ? quietActionClass : primaryActionClass;
  const link = action.native
    ? <Link to={action.url} className={className}>{action.label}</Link>
    : <ExternalLink href={action.url} className={className}>{action.label}</ExternalLink>;
  return placement === 'header'
    ? <div className="ms-auto flex justify-end py-2xs">{link}</div>
    : link;
}

export default function RegistrationAction({ placement = 'lead' }) {
  const action = useRegistrationLink();
  return <RegistrationLink action={action} placement={placement} />;
}
