import { Link } from 'react-router-dom';
import { quietActionClass } from './controlClasses.js';

export default function RoleSwitcher({ account, linkClass = quietActionClass, labelClass = 'text-caption', onNavigate }) {
  if (account.views.length < 2) return null;
  return (
    <nav aria-label="Account views" className="w-full">
      <p className={`mb-2xs ${labelClass}`}>View as: {account.current?.label}</p>
      <ul className="flex flex-col gap-2xs">
        {account.views.map((view) => (
          <li key={view.id}>
            <Link
              to={view.to}
              aria-current={view.id === account.current?.id ? 'page' : undefined}
              className={`${linkClass} w-full min-h-11 aria-[current=page]:font-bold aria-[current=page]:underline underline-offset-4`}
              onClick={() => { account.select(view.id); onNavigate?.(); }}
            >{view.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
