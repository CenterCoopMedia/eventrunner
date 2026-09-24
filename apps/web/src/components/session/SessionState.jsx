// SessionState — the words that say where a session stands (issue #167).
//
// IN WORDS, AND THEN IN INK. A tinted pill that says nothing in words fails
// a reader who cannot see it, so the mark is the sentence itself — "Running
// now", "Finished" — drawn through the state marker device (components/
// editorial/StateMarker.jsx; expansion record §3.2): the word in the data
// face, the accent while the session runs, the back-issue ink and the
// hairline once it has finished. The mark sits beside the title, where a
// reader scanning the programme already looks.
import StateMarker from '../editorial/StateMarker.jsx';

const STATE_WORD = {
  running: 'Running now',
  finished: 'Finished',
};

const STATE_TONE = {
  running: 'live',
  finished: 'past',
};

/**
 * @param {{ state?: 'running' | 'finished' | null, className?: string }} props
 */
export default function SessionState({ state, className = '' }) {
  const word = STATE_WORD[state];
  if (!word) return null;
  return (
    <StateMarker tone={STATE_TONE[state]} className={className}>
      {word}
    </StateMarker>
  );
}
