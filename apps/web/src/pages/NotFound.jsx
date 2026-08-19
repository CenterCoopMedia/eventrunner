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
          className="touch-target inline-flex items-center rounded-brand bg-brand-primary px-6 py-3 font-semibold text-brand-surface hover:bg-brand-primary-dark"
        >
          Go to the home page
        </Link>
      }
    />
  );
}
