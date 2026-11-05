import { useState } from 'react';
import { useLocation } from 'react-router';
import ConnectionPanel, { ConnectionNotice } from '../../setup/ConnectionPanel.jsx';
import { setupPath, stepById, TICKET_CHOICES } from '../../setup/steps.js';

const PROVIDERS = TICKET_CHOICES.filter((choice) => choice.connect).map((choice) => choice.value);

/**
 * Step 5: how the event sells tickets. A client who sells with Stripe or
 * Eventbrite connects their own account here (ADR 0007 §4), and picks an
 * Eventbrite event. A connected account that is no longer the choice stays
 * listed, so the client can disconnect it.
 */
export default function TicketsStep({ value, errors, onChange, app, orgId, appId, flush, onConnections }) {
  const { state } = useLocation();
  const error = errors['tickets.choice'];
  const { connections } = app;
  const [retained, setRetained] = useState([]);
  const shown = PROVIDERS.filter((provider) => retained.includes(provider) || provider === value.choice || connections[provider].connected);
  return (
    <div className="stack">
      <p className="lead">Choose how people get tickets. You can change your choice until you accept the agreement.</p>
      <ConnectionNotice message={state?.connectionMessage} />
      <fieldset
        className="choices"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? 'f-tickets-choice-error' : undefined}
      >
        <legend>Ticket sales</legend>
        {TICKET_CHOICES.map((choice, index) => {
          const unavailable = choice.connect && !connections[choice.value].available;
          return (
            <label key={choice.value} className="choice">
              <input
                type="radio"
                name="tickets-choice"
                id={index === 0 ? 'f-tickets-choice' : undefined}
                value={choice.value}
                checked={value.choice === choice.value}
                disabled={unavailable && value.choice !== choice.value}
                onChange={() => onChange({ choice: choice.value }, 'tickets.choice')}
              />
              <span><strong>{choice.label}</strong>: {choice.help}{unavailable ? ' Not available yet.' : ''}</span>
            </label>
          );
        })}
      </fieldset>
      {error ? <p id="f-tickets-choice-error" className="field-error">{error}</p> : null}
      {shown.map((provider) => (
        <ConnectionPanel
          key={provider}
          provider={provider}
          orgId={orgId}
          appId={appId}
          connections={connections}
          canConnect={connections.canChange && (!retained.includes(provider) || provider === value.choice || connections[provider].connected)}
          errors={provider === value.choice ? errors : {}}
          myRole={app.myRole}
          beforeLeave={flush}
          returnPath={setupPath(orgId, appId, stepById('tickets'))}
          onConnections={onConnections}
          preserveResult
          onResult={() => setRetained((previous) => previous.includes(provider) ? previous : [...previous, provider])}
        />
      ))}
    </div>
  );
}
