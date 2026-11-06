import { useState } from 'react';
import { Link } from 'react-router';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { isReadOnlyDemo } from '../lib/readOnlyDemo.js';
import { quietActionClass } from './controlClasses.js';

function CompactRoleSwitcher({ account, linkClass, selectClass, labelClass, onNavigate }) {
  const [stagedId, setStagedId] = useState(account.current?.id);
  const selected = account.views.find((view) => view.id === stagedId) ?? account.current ?? account.views[0];
  return (
    <div className="flex w-full items-center gap-xs">
      <label className={`flex min-w-0 flex-1 items-center gap-xs ${labelClass}`}>
        <span>View</span>
        <select
          className={`min-w-0 flex-1 ${selectClass}`}
          value={selected.id}
          onChange={(event) => setStagedId(event.target.value)}
        >
          {account.views.map((view) => <option key={view.id} value={view.id}>{view.label}</option>)}
        </select>
      </label>
      <Link to={selected.to} className={`${linkClass} shrink-0`} onClick={() => {
        account.select(selected.id);
        onNavigate?.();
      }}>Open</Link>
    </div>
  );
}

export default function RoleSwitcher({ account, presentation = 'links', linkClass = quietActionClass, selectClass = '', labelClass = 'text-caption', onNavigate }) {
  const { eventConfig } = useEventConfig();
  if (isReadOnlyDemo(eventConfig) || account.views.length < 2) return null;
  if (presentation === 'select') {
    return <CompactRoleSwitcher key={account.current?.id} account={account} linkClass={linkClass}
      selectClass={selectClass} labelClass={labelClass} onNavigate={onNavigate} />;
  }
  return (
    <nav aria-label="Account views" className="w-full">
      <p className={`mb-2xs ${labelClass}`}>View as: {account.current?.label}</p>
      <ul className="flex flex-col gap-2xs">
        {account.views.map((view) => (
          <li key={view.id}>
            <Link
              to={view.to}
              aria-current={view.id === account.current?.id ? 'true' : undefined}
              className={`${linkClass} w-full min-h-11 aria-[current=true]:font-bold aria-[current=true]:underline underline-offset-4`}
              onClick={() => { account.select(view.id); onNavigate?.(); }}
            >{view.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
