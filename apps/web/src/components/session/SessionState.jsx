// SessionState — the words that say where a session stands (issue #167).
//
// IN WORDS, AND THEN IN INK. A tinted pill that says nothing in words fails
// a reader who cannot see it, so the mark is the sentence itself — "Running
// now", "Finished" — and the one tag shape the system has only carries it.
// The mark sits beside the title, where a reader scanning the programme
// already looks.
import Tag from '../editorial/Tag.jsx';

const STATE_WORD = {
  running: 'Running now',
  finished: 'Finished',
};

/**
 * @param {{ state?: 'running' | 'finished' | null, className?: string }} props
 */
export default function SessionState({ state, className = '' }) {
  const word = STATE_WORD[state];
  if (!word) return null;
  return <Tag className={className}>{word}</Tag>;
}
