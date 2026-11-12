import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { STEPS, setupPath } from './steps.js';

/** One navigation list: beside the step on wide screens, folded above it on phones. */
export default function StepList({ step, progress, open, orgId, appId, onGo, disabled }) {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 52rem)').matches);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 52rem)');
    const update = () => setWide(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const done = STEPS.filter((s) => progress[s.id]).length;
  const list = (
    <>
      <p className="muted" id="step-progress">{done} of {STEPS.length} steps done</p>
      <ol className="steps" aria-describedby="step-progress">
        {STEPS.map((s, i) => {
          const current = s.id === step.id;
          if (!open.includes(s.id)) {
            return (
              <li key={s.id}>
                <span className="step-locked">
                  <span className="step-number" aria-hidden="true">{progress[s.id] ? '✓' : i + 1}</span>
                  <span>{s.title}</span>
                  <span className="visually-hidden"> {progress[s.id] ? '(done)' : '(not open yet)'}</span>
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
                <span className="step-number" aria-hidden="true">{progress[s.id] ? '✓' : i + 1}</span>
                <span>{s.title}</span>
                {progress[s.id] ? <span className="visually-hidden"> (done)</span> : null}
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
