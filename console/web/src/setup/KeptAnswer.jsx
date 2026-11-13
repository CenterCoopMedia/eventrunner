import { useState } from 'react';
import { readKeptAnswer, removeKeptAnswer } from './keptAnswers.js';

/** Never replace an answer a teammate may have saved without asking. */
export default function KeptAnswer({ scope, step, onUse, onDone }) {
  // The form can still show an optimistic value the server refused. Only
  // a successful save, explicit discard or explicit sign-out clears a copy.
  const [kept, setKept] = useState(() => readKeptAnswer(scope, step));
  if (!kept) return null;
  function finish(use) {
    if (use) onUse(kept.answers);
    else removeKeptAnswer(scope, kept);
    setKept(null);
    onDone();
  }
  return (
    <div className="message" role="status">
      <p>This tab kept an answer from an unfinished save. Your teammate may have changed the saved answer since.</p>
      <div className="step-actions">
        <button type="button" className="button" onClick={() => finish(true)}>Use kept answer</button>
        <button type="button" className="button" onClick={() => finish(false)}>Discard kept answer</button>
      </div>
    </div>
  );
}
