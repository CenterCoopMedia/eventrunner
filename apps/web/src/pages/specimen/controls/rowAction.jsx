// The control on a schedule row: text in the data face, never a box.
import { rowActionClass } from '../../../components/session/sessionActionClass.js';
import { FORCED_FOCUS, FORCED_PRESS } from './states.js';

const CLASS_FOR_STATE = Object.freeze({
  rest: rowActionClass,
  // The text register takes no tint — a tint behind a row control would be
  // the box the register exists to remove — so its hover is the ink and the
  // underline the shape already carries.
  hover: `${rowActionClass} !text-text-primary underline`,
  focus: `${rowActionClass} ${FORCED_FOCUS}`,
  pressed: `${rowActionClass} ${FORCED_PRESS}`,
  selected: rowActionClass,
  busy: rowActionClass,
});

const WORD_FOR_STATE = Object.freeze({
  selected: 'Bookmarked',
  busy: 'Bookmarking…',
});

export default Object.freeze({
  id: 'row-action',
  name: 'Row action',
  file: 'components/session/sessionActionClass.js',
  contract: null,
  note: 'Nothing on a schedule row is boxed, so the reader keeps running down the time column. The bookmark is the toggle: the selected state is aria-pressed, the word, and the weight.',
  states: Object.freeze(['rest', 'hover', 'focus', 'pressed', 'selected', 'busy']),
  absent: Object.freeze([
    Object.freeze({
      state: 'disabled',
      reason: 'A row control that cannot be used is not drawn. The text register has no ground, so its unavailable ink is the ink it already sits in — a dead “Bookmark” under every session on the page would be a refusal repeated thirty times and legible as nothing.',
    }),
    Object.freeze({
      state: 'error',
      reason: 'A row control acts on one session and states its own failure as a line under the row, not on itself.',
    }),
    Object.freeze({
      state: 'success',
      reason: 'The word is the result: a bookmark that landed reads “Bookmarked”.',
    }),
    Object.freeze({ state: 'empty', reason: 'An empty state belongs to the list, not to the row control.' }),
  ]),
  render: (state) => (
    <button
      type="button"
      className={CLASS_FOR_STATE[state]}
      aria-pressed={state === 'selected' ? 'true' : undefined}
      aria-busy={state === 'busy' ? 'true' : undefined}
    >
      <span aria-hidden="true">{state === 'selected' ? '★' : '☆'}</span>
      {WORD_FOR_STATE[state] ?? 'Bookmark'}
    </button>
  ),
});
