// Narrow a list by words (expansion record §3.3).
//
// THE RESULT IS SPOKEN, NOT ONLY SHOWN. A list that shrinks under a typed
// query says nothing to a reader who cannot see it shrink, so the count sits
// in a `role="status"` line and is announced. The caller passes the sentence,
// because only the caller knows what is being counted and what was searched:
// "12 sessions match “opening”" tells a reader both halves, and "12 results"
// tells them neither.
//
// THE CLEAR CONTROL IS A REAL BUTTON. `type="search"` draws a clear control
// of its own in some browsers and none in others, and the one it draws is
// out of the keyboard path in several. A stated control is in the tab order
// everywhere and says what it does.
//
// The clear control is rendered only when there is something to clear. A
// control that does nothing is a dead end (interface guidelines, Writing).
//
// CLEARING MOVES FOCUS TO THE FIELD. The control exists only while there is
// a query, so clearing the query removes the control — and an element
// removed while it holds focus drops focus to the body, which sends a
// keyboard reader back to the start of the page. The field is where the
// reader was working and where they would type next, so the field takes
// focus before the control goes.
import { useId, useRef } from 'react';
import { inputClass, quietActionClass } from '../controlClasses.js';

/**
 * @param {object} props
 * @param {string} props.label what the query searches
 * @param {string} props.value
 * @param {(next: string) => void} props.onChange
 * @param {string} [props.status] the count sentence the caller states
 * @param {string} [props.placeholder]
 */
export default function SearchField({ label, value, onChange, status, placeholder }) {
  const id = useId();
  const statusId = `${id}-status`;
  const inputRef = useRef(null);

  function clear() {
    // The field is focused first: React removes the control in the render
    // this state change causes, and by then the reader is already on the
    // field rather than on nothing.
    inputRef.current?.focus();
    onChange('');
  }

  return (
    <div className="flex flex-col gap-2xs">
      <label htmlFor={id} className="font-data text-caption font-semibold text-text-primary">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-xs">
        <input
          id={id}
          ref={inputRef}
          type="search"
          className={`${inputClass} sm:w-auto sm:flex-1`}
          value={value}
          placeholder={placeholder}
          aria-describedby={status ? statusId : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        {value ? (
          <button type="button" className={quietActionClass} onClick={clear}>
            Clear search
          </button>
        ) : null}
      </div>
      {/* The line is always in the document, so a reader's assistive
          technology is already watching it when the first count arrives. */}
      <p id={statusId} role="status" className="font-data text-caption text-text-secondary">
        {status}
      </p>
    </div>
  );
}
