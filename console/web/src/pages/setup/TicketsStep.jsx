import { CONNECT_LATER, TICKET_CHOICES } from '../../setup/steps.js';

/**
 * Step 5: how the event sells tickets. This step records the choice only.
 * The Stripe and Eventbrite connect buttons come after approval (ADR 0007 §4).
 */
export default function TicketsStep({ value, errors, onChange }) {
  const error = errors['tickets.choice'];
  const chosen = TICKET_CHOICES.find((choice) => choice.value === value.choice);
  return (
    <div className="stack">
      <p className="lead">Choose how people get tickets. You can change this until we approve your request.</p>
      <fieldset
        className="choices"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? 'f-tickets-choice-error' : undefined}
      >
        <legend>Ticket sales</legend>
        {TICKET_CHOICES.map((choice, index) => (
          <label key={choice.value} className="choice">
            <input
              type="radio"
              name="tickets-choice"
              id={index === 0 ? 'f-tickets-choice' : undefined}
              value={choice.value}
              checked={value.choice === choice.value}
              onChange={() => onChange({ choice: choice.value }, 'tickets.choice')}
            />
            <span><strong>{choice.label}</strong>: {choice.help}</span>
          </label>
        ))}
      </fieldset>
      {error ? <p id="f-tickets-choice-error" className="field-error">{error}</p> : null}
      {chosen?.connect ? (
        <aside className="note" role="note">
          <p className="note-title">{chosen.label}</p>
          <p>{CONNECT_LATER}</p>
        </aside>
      ) : null}
    </div>
  );
}
