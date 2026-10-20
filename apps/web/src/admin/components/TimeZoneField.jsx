import { useEffect, useId, useMemo, useState } from 'react';
import { isKnownTimeZone } from '../../lib/eventDateTime.js';
import {
  describeEventDayOffsets,
  describeZoneOption,
  filterTimeZoneOptions,
  timeZoneOptions,
} from '../../lib/timeZoneOptions.js';
import { FieldError, fieldHintClass, fieldLabelClass, inputClass } from './formControls.jsx';

// The event's time zone (issue #475). Staff search for a city, a region, a
// zone's usual name ("Eastern Time"), or an offset ("UTC+05:30") and pick
// from the list. The stored value is the IANA name, as before; it is shown
// once under the field and never has to be typed.
//
// The WAI-ARIA editable combobox with list autocomplete: focus stays in the
// text field, and aria-activedescendant names the option the arrows are on.
// Down or Up opens the list, Enter chooses, Escape closes and puts the saved
// zone back. Leaving the field without choosing changes nothing, so a
// half-typed search is never saved. The list sits in the flow under the
// field rather than floating over the form, so it wraps and scrolls at any
// width and zoom.

const PAGE_STEP = 10;

const optionClass =
  'flex cursor-pointer flex-col gap-3xs border-admin-rule-hairline border-b-admin-hairline px-sm py-xs ' +
  'text-admin-sm text-admin-ink last:border-b-0 hover:bg-admin-ground-soft ' +
  'aria-selected:bg-admin-action-soft aria-selected:outline aria-selected:outline-2 ' +
  'aria-selected:-outline-offset-2 aria-selected:outline-admin-action';

/**
 * @param {object} props
 * @param {string} props.value the stored IANA name
 * @param {(value: string) => void} props.onChange the chosen IANA name
 * @param {string} [props.label]
 * @param {string} [props.error] the server's message for this field
 * @param {{ date?: string, startTime?: string }[]} [props.days] the event days, for the offset line
 * @param {Date} [props.now] the moment whose offsets the list shows; now by default
 */
export default function TimeZoneField({ value, onChange, label = 'Time zone', error, days = [], now }) {
  const id = useId();
  const inputId = `${id}-input`;
  const labelId = `${id}-label`;
  const listId = `${id}-list`;
  const hintId = `${id}-hint`;
  const offsetsId = `${id}-offsets`;
  const errorId = `${id}-error`;
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  // null while the field shows the saved zone; the typed text while searching.
  const [query, setQuery] = useState(null);
  const [active, setActive] = useState(-1);

  const instant = useMemo(() => now ?? new Date(), [now]);
  const known = isKnownTimeZone(value);
  const selected = useMemo(() => (known ? describeZoneOption(value, instant) : null), [known, value, instant]);
  // Building every zone touches each one through Intl, so the list waits
  // for the field to be used.
  const options = useMemo(() => (loaded ? timeZoneOptions(instant, known ? value : '') : []), [loaded, instant, known, value]);
  const matches = useMemo(() => filterTimeZoneOptions(options, query ?? ''), [options, query]);
  const expanded = open && matches.length > 0;
  const activeId = expanded && active >= 0 && active < matches.length ? `${id}-option-${active}` : undefined;

  useEffect(() => {
    if (!activeId) return;
    document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  const offsets = describeEventDayOffsets(value, days);
  const shown = query ?? (selected ? selected.display : value ?? '');
  const describedBy = [hintId, offsets ? offsetsId : null, error ? errorId : null].filter(Boolean).join(' ');

  function openAt(index) {
    setLoaded(true);
    setOpen(true);
    setActive(index);
  }

  function savedIndex(list) {
    const at = list.findIndex((option) => option.value === value);
    return at >= 0 ? at : 0;
  }

  function choose(option) {
    setQuery(null);
    setOpen(false);
    setActive(-1);
    if (option.value !== value) onChange(option.value);
  }

  function reset() {
    setQuery(null);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(event) {
    // The full list, for a key pressed before the first render that loads it.
    const list = loaded ? matches : filterTimeZoneOptions(timeZoneOptions(instant, known ? value : ''), query ?? '');
    const last = list.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open || active < 0) openAt(event.altKey || query === null ? savedIndex(list) : 0);
        else setActive(Math.min(active + 1, last));
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!open || active < 0) openAt(query === null ? savedIndex(list) : last);
        else setActive(Math.max(active - 1, 0));
        break;
      case 'PageDown':
        if (!expanded) break;
        event.preventDefault();
        setActive(Math.min(active + PAGE_STEP, last));
        break;
      case 'PageUp':
        if (!expanded) break;
        event.preventDefault();
        setActive(Math.max(active - PAGE_STEP, 0));
        break;
      case 'Enter':
        // While the list is open, Enter answers the list, not the form.
        if (!open) break;
        event.preventDefault();
        if (activeId) choose(list[active]);
        break;
      case 'Escape':
        if (open || query !== null) {
          event.preventDefault();
          reset();
        }
        break;
      case 'Tab':
        reset();
        break;
      default:
        break;
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-3xs">
      <label id={labelId} htmlFor={inputId} className={fieldLabelClass}>{label}</label>
      <p id={hintId} className={`${fieldHintClass} text-pretty`}>
        {known
          ? `Search by city, region, or UTC offset. Saved as ${value}.`
          : value
            ? `${value} is not a time zone this browser knows. Choose one from the list.`
            : 'Search by city, region, or UTC offset, then choose one from the list.'}
      </p>
      <input
        id={inputId}
        type="text"
        role="combobox"
        className={inputClass}
        value={shown}
        autoComplete="off"
        spellCheck={false}
        aria-autocomplete="list"
        aria-expanded={expanded ? 'true' : 'false'}
        aria-controls={listId}
        aria-activedescendant={activeId}
        aria-describedby={describedBy}
        aria-invalid={error ? 'true' : undefined}
        onFocus={(event) => {
          setLoaded(true);
          // The words of the saved zone are selected, so the first key
          // typed starts a new search instead of adding to them.
          if (query === null) event.target.select();
        }}
        // A click lands after focus and would drop the selection.
        onClick={(event) => { if (query === null) event.target.select(); }}
        onChange={(event) => {
          setQuery(event.target.value);
          openAt(0);
        }}
        onKeyDown={onKeyDown}
        onBlur={reset}
      />
      {/* The list stays in the DOM so aria-controls always names it. */}
      <ul
        id={listId}
        role="listbox"
        aria-labelledby={labelId}
        hidden={!expanded}
        // A press on an option must not blur the field first: the blur
        // would close the list before the click lands.
        onMouseDown={(event) => event.preventDefault()}
        className="max-h-72 overflow-y-auto rounded-admin border-admin-hairline border-admin-rule-control bg-admin-ground-raised"
      >
        {expanded
          ? matches.map((option, index) => (
            <li
              key={option.value}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={index === active ? 'true' : 'false'}
              className={optionClass}
              onClick={() => choose(option)}
            >
              <span className="flex flex-wrap items-baseline justify-between gap-x-sm">
                <span className="font-semibold">
                  {option.city}
                  {option.region ? <span className="font-normal text-admin-ink-secondary">, {option.region}</span> : null}
                </span>
                {option.value === value ? (
                  <span className="text-admin-xs font-semibold text-admin-ink">
                    <span aria-hidden="true">✓ </span>Current
                  </span>
                ) : null}
              </span>
              <span className="text-admin-ink-secondary">
                {option.name ? `${option.name} · ` : ''}
                <span className="font-admin-data">{option.offsetLabel}</span>
              </span>
            </li>
          ))
          : null}
      </ul>
      <p aria-live="polite" className="sr-only">
        {open && query !== null && matches.length > 0
          ? `${matches.length} time zone${matches.length === 1 ? '' : 's'} match.`
          : ''}
      </p>
      {open && query !== null && query.trim() && matches.length === 0 && loaded ? (
        <p className={fieldHintClass}>No time zone matches “{query.trim()}”. Try a city or a UTC offset.</p>
      ) : null}
      {offsets ? <p id={offsetsId} className={fieldHintClass}>{offsets}</p> : null}
      <FieldError id={errorId} message={error} />
    </div>
  );
}
