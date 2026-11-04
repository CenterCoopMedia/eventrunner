import { useEffect, useState } from 'react';
import { callApi } from '../../api.js';
import { TextField } from '../../setup/Field.jsx';
import { SITE_DOMAIN } from '../../setup/steps.js';

const CHECK_DELAY = 300;

/**
 * Ask the server about a name while the client types. The server holds
 * the one rule set and the list of names in use, so the browser does not
 * guess. Returns null while there is nothing to say.
 */
function useNameCheck(name, appId) {
  const [verdict, setVerdict] = useState(null);
  useEffect(() => {
    const clean = name.trim().toLowerCase();
    if (!clean) {
      setVerdict(null);
      return undefined;
    }
    let live = true;
    const timer = setTimeout(() => {
      callApi('checkWebAddress', { name: clean, appId })
        .then((result) => { if (live) setVerdict(result); })
        .catch(() => { if (live) setVerdict(null); });
    }, CHECK_DELAY);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [name, appId]);
  return verdict;
}

/** Step 3: the name in `name.eventrunner.org`. */
export default function WebAddressStep({ value, errors, onChange, onBlur, appId }) {
  const verdict = useNameCheck(value.name, appId);
  const shown = value.name.trim().toLowerCase() || 'your-name';
  const current = verdict && verdict.name === value.name.trim().toLowerCase() ? verdict : null;
  const error = current && !current.available ? current.message : errors['webAddress.name'];

  return (
    <div className="stack">
      <p className="lead">Your site starts at a free address on {SITE_DOMAIN}. You can add your own domain later.</p>
      <TextField
        path="webAddress.name"
        label="Name"
        hint="3 to 27 lowercase letters, numbers and hyphens. For example, nclocal"
        autoComplete="off"
        maxLength={27}
        value={value.name}
        onChange={(next) => onChange({ name: next.toLowerCase() }, 'webAddress.name')}
        onBlur={() => onBlur('webAddress.name')}
        error={error}
      />
      <p className="preview" aria-label="Web address preview">
        <span className="preview-label">Your web address</span>
        <span className="preview-value">{shown}.{SITE_DOMAIN}</span>
      </p>
      <p role="status" className="availability">
        {current?.available ? `${current.address} is available. We keep it for you while you finish.` : ''}
      </p>
    </div>
  );
}
