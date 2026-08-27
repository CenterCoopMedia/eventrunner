// 404 route. Orients the reader and offers exactly one next action.
import { Link } from 'react-router-dom';
import EmptyState from '../components/EmptyState.jsx';

export default function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      description="The address may be mistyped, or the page may have moved."
      action={
        <Link
          to="/"
          className="touch-target inline-flex items-center rounded-brand bg-accent px-md py-xs font-data text-caption font-semibold text-surface hover:bg-accent-strong"
        >
          Go to the home page
        </Link>
      }
    />
  );
}
