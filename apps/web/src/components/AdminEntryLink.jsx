import { Link } from 'react-router-dom';
import { quietActionClass } from './controlClasses.js';

export default function AdminEntryLink({ account }) {
  const views = account?.views ?? [];
  if (views.length < 2 || !views.some((view) => view.id === 'admin')) return null;
  return <Link to="/admin" className={`${quietActionClass} mt-sm`}>Manage event</Link>;
}
