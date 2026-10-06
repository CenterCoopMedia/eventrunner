import { Link } from 'react-router-dom';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { isReadOnlyDemo } from '../lib/readOnlyDemo.js';
import { quietActionClass } from './controlClasses.js';

export default function RoleSwitcher({ account, linkClass = quietActionClass, labelClass = 'text-caption', onNavigate }) {
  const { eventConfig } = useEventConfig();
  if (isReadOnlyDemo(eventConfig) || account.views.length < 2) return null;
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
