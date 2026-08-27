// 404 route. Orients the reader and offers exactly one next action.
import { Link } from 'react-router-dom';
import EmptyState from '../components/EmptyState.jsx';
import { primaryActionClass } from '../components/controlClasses.js';

export default function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      description="The address may be mistyped, or the page may have moved."
      action={
        <Link to="/" className={primaryActionClass}>
          Go to the home page
        </Link>
      }
    />
  );
}
