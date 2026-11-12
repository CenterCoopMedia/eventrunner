import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { STEPS, setupPath } from './steps.js';

/** One navigation list: beside the step on wide screens, folded above it on phones. */
export default function StepList({ step, progress, open, ownersNeeded, reason, orgId, appId, onGo, disabled }) {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 52rem)').matches);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 52rem)');
    const update = () => setWide(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const isDone = (id) => id === 'team' ? ownersNeeded === 0 : progress[id];
  const done = STEPS.filter((s) => isDone(s.id)).length;
  const list = (
    <>
      <p className="muted" id="step-progress">{done} of {STEPS.length} steps done</p>
      <ol className="steps" aria-describedby="step-progress">
        {STEPS.map((s, i) => {
          const current = s.id === step.id;
          const available = open.includes(s.id);
          const body = (
            <>
              <span className="step-number" aria-hidden="true">{isDone(s.id) ? '✓' : i + 1}</span>
              <span className="step-text">
                <span>{s.title}</span>
                <span className="step-state">{!available ? 'Not started' : isDone(s.id) ? 'Done' : 'To do'}</span>
                {!available && reason ? <span className="step-reason">{reason}</span> : null}
              </span>
            </>
          );
          if (!available) {
            return (
              <li key={s.id}>
                <span className="step-locked">
                  {body}
                </span>
              </li>
            );
          }
          return (
            <li key={s.id} className={current ? 'current' : undefined}>
              <Link
                to={setupPath(orgId, appId, s)}
                aria-current={current ? 'step' : undefined}
                aria-disabled={disabled || undefined}
                onClick={(e) => onGo(e, s)}
              >
                {body}
              </Link>
            </li>
          );
        })}
      </ol>
    </>
  );
  return (
    <nav aria-label="Setup steps" className="step-nav">
      {wide ? list : (
        <details key={step.id} className="step-nav-fold">
          <summary>Show all {STEPS.length} steps</summary>
          {list}
        </details>
      )}
    </nav>
  );
}
