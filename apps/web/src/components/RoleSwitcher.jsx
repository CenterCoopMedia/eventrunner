import { Link, useNavigate } from 'react-router';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { isReadOnlyDemo } from '../lib/readOnlyDemo.js';
import { quietActionClass } from './controlClasses.js';

export default function RoleSwitcher({ account, presentation = 'links', linkClass = quietActionClass, selectClass = '', labelClass = 'text-caption', onNavigate }) {
  const { eventConfig } = useEventConfig();
  const navigate = useNavigate();
  if (isReadOnlyDemo(eventConfig) || account.views.length < 2) return null;
  if (presentation === 'select') {
    return (
      <label className={`flex w-full items-center gap-xs ${labelClass}`}>
        <span>View</span>
        <select
          className={`min-w-0 flex-1 ${selectClass}`}
          value={account.current?.id ?? ''}
          onChange={(event) => {
            const view = account.views.find((entry) => entry.id === event.target.value);
            if (!view) return;
            account.select(view.id);
            onNavigate?.();
            navigate(view.to);
          }}
        >
          {account.views.map((view) => <option key={view.id} value={view.id}>{view.label}</option>)}
        </select>
      </label>
    );
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
