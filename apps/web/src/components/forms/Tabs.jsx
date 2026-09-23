// One panel from a short set (expansion record §3.3): the ARIA tab pattern.
//
// FOUR PARTS, ONE CONTRACT. `Tabs` holds which panel is open. `TabList` is
// the row. `Tab` is one word in it. `TabPanel` is what that word opens. A
// caller composes them, so a tab can hold any content and this file holds no
// opinion about what that content is.
//
// THE LIST HOLDS ONE TAB STOP. Tab reaches the open tab, the arrow keys move
// along the row, and Home and End reach the ends. Tab again leaves the row
// and lands in the open panel. That is the pattern's own keyboard.
//
// THE STOP FOLLOWS FOCUS (adversarial review of the 2026-09-10 wave). An
// unavailable tab can hold focus without being selected, and a stop pinned
// to the selected tab would send Tab and Shift+Tab from that focused tab
// back into the row. So the row remembers which tab holds focus and gives
// that one the stop, falling back to the open tab when focus is elsewhere;
// exactly one tab has tabindex 0 at any time.
//
// Selection follows focus, which is the pattern's default. A panel opens the
// moment its tab is reached, so a reader moving along the row never has to
// press a second key to see what a word holds.
//
// THE SELECTED TAB CARRIES THE STRONG RULE. It is the same boundary device a
// section head takes, so the row reads as the page's own typography rather
// than as a widget. Never a pill, never a filled tab.
import { createContext, useContext, useId, useRef, useState } from 'react';
import { controlStateClass } from '../controlClasses.js';
import { nextRovingIndex } from './rovingKeys.js';

const TabsContext = createContext(null);

function useTabs(part) {
  const context = useContext(TabsContext);
  if (!context) throw new Error(`<${part}> must be used inside <Tabs>.`);
  return context;
}

/**
 * @param {object} props
 * @param {string} props.value the open tab's id
 * @param {(next: string) => void} props.onChange
 * @param {string[]} props.tabs every tab id, in the order they are rendered
 */
export function Tabs({ value, onChange, tabs, children }) {
  const baseId = useId();
  const listRef = useRef(null);
  // The tab that holds focus, or null when focus is outside the row.
  const [focusedId, setFocusedId] = useState(null);
  return (
    <TabsContext.Provider
      value={{ baseId, value, onChange, tabs, listRef, focusedId, setFocusedId }}
    >
      {children}
    </TabsContext.Provider>
  );
}

/** The tab element an event happened in, or null. */
function tabOf(node) {
  return typeof node?.closest === 'function' ? node.closest('[role="tab"]') : null;
}

/**
 * The row of words.
 *
 * THE REASON IS SHOWN, NOT ONLY READ. An unavailable tab's `hint` is part of
 * its accessible name; while that tab has focus or the pointer, the same
 * words are drawn under the row, so a sighted reader learns why the word
 * does not open without a screen reader. The line is hidden from
 * assistive technology, which already has the reason in the name.
 */
export function TabList({ label, children }) {
  const { value, onChange, tabs, listRef, focusedId, setFocusedId } = useTabs('TabList');
  // The unavailable tab's reason, for the tab that has focus and for the
  // one under the pointer. Either shows it; the pointer's wins while both.
  const [focusedReason, setFocusedReason] = useState(null);
  const [hoveredReason, setHoveredReason] = useState(null);

  function onKeyDown(event) {
    // The arrow keys move from where the reader IS, which may be an
    // unavailable tab that holds focus without being open.
    const from = Math.max(0, tabs.indexOf(focusedId ?? value));
    const index = nextRovingIndex(event.key, from, tabs.length);
    if (index === null) return;
    event.preventDefault();
    const target = listRef.current?.querySelectorAll('[role="tab"]')[index];
    target?.focus();
    // Selection follows focus — except onto a tab that states it is
    // unavailable. The reader lands on it and hears why; the open panel
    // stays where it was.
    if (target?.getAttribute('aria-disabled') === 'true') return;
    onChange(tabs[index]);
  }

  function onFocus(event) {
    const tab = tabOf(event.target);
    if (!tab) return;
    setFocusedId(tab.dataset.tab);
    setFocusedReason(tab.dataset.hint ?? null);
  }

  function onBlur(event) {
    // Focus left the row: the stop returns to the open tab, so a reader
    // who tabs back in lands on what is open rather than on what is not.
    if (listRef.current?.contains(event.relatedTarget)) return;
    setFocusedId(null);
    setFocusedReason(null);
  }

  const reason = hoveredReason ?? focusedReason;

  return (
    <>
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        className="tab-list"
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        onMouseOver={(event) => setHoveredReason(tabOf(event.target)?.dataset.hint ?? null)}
        onMouseLeave={() => setHoveredReason(null)}
      >
        {children}
      </div>
      {reason ? (
        <p aria-hidden="true" className="tab-list__reason mt-2xs font-data text-caption text-text-secondary">
          {reason}
        </p>
      ) : null}
    </>
  );
}

const tabClass =
  `${controlStateClass} tab touch-target inline-flex items-center px-md py-xs font-data ` +
  'text-caption font-medium text-text-secondary aria-selected:text-text-primary';

/**
 * One word in the row.
 *
 * AN UNAVAILABLE TAB STAYS IN THE ROW AND EXPLAINS ITSELF (expansion record
 * §2.1). It carries `aria-disabled="true"` rather than `disabled`, so the
 * arrow keys can still land on it and a screen reader hears that it is
 * unavailable and why — `hint` is read as part of the tab's name — and its
 * handler refuses every activation path: a click, Enter and Space all
 * arrive here and go nowhere, and the arrow keys never select it. A sighted
 * reader sees it too: the stylesheet draws a dashed rule under the word in
 * place of the strong rule an open tab takes, and the row shows the hint
 * while the tab has focus or the pointer. A tab with nothing behind it at
 * all is not rendered; this is for a panel that exists and cannot be opened
 * yet.
 *
 * @param {{
 *   id: string,
 *   children: import('react').ReactNode,
 *   disabled?: boolean,
 *   hint?: string,     // why it is unavailable
 * }} props
 */
export function Tab({ id, children, disabled = false, hint }) {
  const { baseId, value, onChange, focusedId } = useTabs('Tab');
  const selected = value === id;
  // The row's one tab stop: the focused tab while there is one, else the
  // open tab.
  const stop = (focusedId ?? value) === id;
  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${id}`}
      data-tab={id}
      data-hint={disabled && hint ? hint : undefined}
      aria-controls={`${baseId}-panel-${id}`}
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      tabIndex={stop ? 0 : -1}
      onClick={() => {
        if (!disabled) onChange(id);
      }}
      className={tabClass}
    >
      {children}
      {disabled && hint ? <span className="sr-only">{` (${hint})`}</span> : null}
    </button>
  );
}

/**
 * What a word opens. Only the open panel renders its content, but every
 * panel keeps its element, so the id `aria-controls` names always resolves
 * and the row is never pointing at nothing.
 */
export function TabPanel({ id, children }) {
  const { baseId, value } = useTabs('TabPanel');
  const open = value === id;
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${id}`}
      aria-labelledby={`${baseId}-tab-${id}`}
      hidden={!open}
      tabIndex={0}
      className="pt-md"
    >
      {open ? children : null}
    </div>
  );
}
