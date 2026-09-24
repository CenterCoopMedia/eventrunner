// Progress — how much of a set of tasks is done (expansion record §3.2).
//
// A NATIVE <progress>, WITH THE FRACTION STATED BESIDE IT. "3 of 5 done" is
// the device; the bar repeats it for a reader who scans. The element is the
// platform's own, so assistive technology reads its value and its maximum
// without a role being bolted on, and the sentence beside it is what names
// it. <meter> is not used: it measures a quantity in a range, not
// completion. Never a ring, and nothing here moves.
//
// The bar is drawn from the tokens (`.progress-bar` in index.css): a track
// inside a hairline on the alternate ground and a flat fill in the accent,
// which a style retunes through the `progress` contract.
import { useId } from 'react';

/**
 * The stated fraction: "3 of 5 tasks done".
 *
 * @param {number} value
 * @param {number} max
 * @param {string} unit what is being counted, plural
 * @param {string} done the word for a finished one
 * @returns {string}
 */
export function progressStatement(value, max, unit = 'tasks', done = 'done') {
  return `${value} of ${max} ${unit} ${done}`.replace(/\s+/gu, ' ').trim();
}

/**
 * @param {{
 *   value: number,
 *   max: number,
 *   unit?: string,          // "tasks", "fields", "files"
 *   done?: string,          // "done", "sent", "complete"
 *   statement?: string,     // the whole sentence, where the default is wrong
 *   className?: string,
 * }} props
 */
export default function Progress({
  value,
  max,
  unit = 'tasks',
  done = 'done',
  statement,
  className = '',
}) {
  const id = useId();
  const total = Number.isFinite(max) && max > 0 ? max : 0;
  const current = Number.isFinite(value) ? Math.min(Math.max(value, 0), total) : 0;
  return (
    <div className={['flex flex-col gap-2xs', className].filter(Boolean).join(' ')}>
      <progress
        className="progress-bar"
        value={current}
        max={total || 1}
        aria-labelledby={id}
      />
      <p id={id} className="progress-label text-caption text-text-secondary">
        {statement ? (
          statement
        ) : (
          <>
            <span data-numeric className="font-mono">
              {current}
            </span>{' '}
            of{' '}
            <span data-numeric className="font-mono">
              {total}
            </span>{' '}
            {`${unit} ${done}`.trim()}
          </>
        )}
      </p>
    </div>
  );
}
