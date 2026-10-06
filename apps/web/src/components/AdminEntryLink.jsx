import { Link } from 'react-router-dom';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { isReadOnlyDemo } from '../lib/readOnlyDemo.js';
import { quietActionClass } from './controlClasses.js';

export default function AdminEntryLink({ account }) {
  const { eventConfig } = useEventConfig();
  const views = account?.views ?? [];
  if (isReadOnlyDemo(eventConfig) || views.length < 2 || !views.some((view) => view.id === 'admin')) return null;
  return <Link to="/admin" className={`${quietActionClass} mt-sm`}>Manage event</Link>;
}
