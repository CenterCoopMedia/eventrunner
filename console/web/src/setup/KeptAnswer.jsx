import { useState } from 'react';
import { readKeptAnswer, removeKeptAnswer } from './keptAnswers.js';

/** Never replace an answer a teammate may have saved without asking. */
export default function KeptAnswer({ scope, step, answer, onUse, onDone }) {
  const [kept, setKept] = useState(() => {
    const copy = readKeptAnswer(scope, step);
    if (copy && JSON.stringify(copy.answers) === JSON.stringify(answer)) {
      removeKeptAnswer(scope, copy);
      return null;
    }
    return copy;
  });
  if (!kept) return null;
  function finish(use) {
    if (use) onUse(kept.answers);
    else removeKeptAnswer(scope, kept);
    setKept(null);
    onDone();
  }
  return (
    <div className="message" role="status">
      <p>This tab kept an answer that was not saved. Your teammate may have changed the saved answer since.</p>
      <div className="step-actions">
        <button type="button" className="button" onClick={() => finish(true)}>Use kept answer</button>
        <button type="button" className="button" onClick={() => finish(false)}>Discard kept answer</button>
      </div>
    </div>
  );
}
