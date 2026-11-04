// The dashboard's reminder to answer the registration questions (ADR 0008
// §5). It shows only when the form asks something and a ticket (or the
// account) has no saved answers; while loading, or on a failed read, it
// draws nothing, so the dashboard never shows a card that may be wrong.
import { Link } from 'react-router';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useRegistrationTargets } from '../lib/useRegistrationTargets.js';

const cardClass = 'rounded-brand-lg border-hairline border-rule-hairline bg-surface-alt p-md';

export default function RegistrationReminderCard() {
  const { user } = useAuth();
  const { status, questionCount, targets, saved } = useRegistrationTargets(user);
  if (status !== 'ready' || !questionCount) return null;
  const left = targets.filter((target) => !saved[target.id]).length;
  if (!left) return null;
  const summary = targets.length === 1
    ? 'The organizers have a few questions for you.'
    : `${left} of ${targets.length} tickets still ${left === 1 ? 'needs' : 'need'} answers.`;
  return (
    <section aria-labelledby="registration-reminder-heading" className={cardClass}>
      <h2 id="registration-reminder-heading" className="font-heading text-h3 font-semibold text-text-primary">
        Complete your registration
      </h2>
      <p className="mt-xs text-body text-text-secondary">{summary}</p>
      <Link to="/registration" className="mt-md inline-block font-medium text-accent hover:underline">
        Answer the questions
      </Link>
    </section>
  );
}
