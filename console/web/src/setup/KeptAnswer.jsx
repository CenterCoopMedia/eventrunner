import { useState } from 'react';
import { readKeptAnswer, removeKeptAnswer } from './keptAnswers.js';

/** Offer every copy, including copies made by an older version of the form. */
export default function KeptAnswer({ scope, step, onUse, onDone }) {
  const [kept, setKept] = useState(() => readKeptAnswer(scope, step));
  const [restored, setRestored] = useState(false);
  // An edit on this visit can supersede the offered copy.
  const offer = kept && JSON.stringify(readKeptAnswer(scope, step)) === JSON.stringify(kept);
  if (!offer && !restored) return null;
  function finish(use) {
    if (use) onUse(kept.answers);
    else removeKeptAnswer(scope, kept);
    setRestored(use);
    setKept(null);
    onDone();
  }
  return (
    <div className="message" role="status">
      {restored ? <p>Draft restored.</p> : (
        <>
          <p>This tab kept an answer from an unfinished save. Your teammate may have changed the saved answer since.</p>
          <div className="step-actions">
            <button type="button" className="button" onClick={() => finish(true)}>Use kept answer</button>
            <button type="button" className="button" onClick={() => finish(false)}>Discard kept answer</button>
          </div>
        </>
      )}
    </div>
  );
}
