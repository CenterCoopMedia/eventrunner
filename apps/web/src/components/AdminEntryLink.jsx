import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import useAccountViews from '../hooks/useAccountViews.js';
import { quietActionClass } from './controlClasses.js';

function MultiRoleAdminLink() {
  const { views } = useAccountViews();
  if (views.length < 2 || !views.some((view) => view.id === 'admin')) return null;
  return <Link to="/admin" className={`${quietActionClass} mt-sm`}>Manage event</Link>;
}

export default function AdminEntryLink() {
  const { user, loading, adminStatus } = useAuth();
  if (!user || loading || adminStatus !== 'admin') return null;
  return <MultiRoleAdminLink />;
}
