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
// Selection follows focus, which is the pattern's default. A panel opens the
// moment its tab is reached, so a reader moving along the row never has to
// press a second key to see what a word holds.
//
// THE SELECTED TAB CARRIES THE STRONG RULE. It is the same boundary device a
// section head takes, so the row reads as the page's own typography rather
// than as a widget. Never a pill, never a filled tab.
import { createContext, useContext, useId, useRef } from 'react';
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
  return (
    <TabsContext.Provider value={{ baseId, value, onChange, tabs, listRef }}>
      {children}
    </TabsContext.Provider>
  );
}

/**
 * The index of the tab that holds focus, or of the selected tab when none
 * does. An unavailable tab can hold focus without being selected, so the
 * arrow keys have to move from where the reader IS rather than from what is
 * open.
 */
function focusedIndex(listRef, tabs, value) {
  const nodes = [...(listRef.current?.querySelectorAll('[role="tab"]') ?? [])];
  const active = nodes.indexOf(globalThis.document?.activeElement);
  return active >= 0 ? active : Math.max(0, tabs.indexOf(value));
}

/** The row of words. */
export function TabList({ label, children }) {
  const { value, onChange, tabs, listRef } = useTabs('TabList');

  function onKeyDown(event) {
    const index = nextRovingIndex(event.key, focusedIndex(listRef, tabs, value), tabs.length);
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

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      className="tab-list"
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
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
 * arrive here and go nowhere, and the arrow keys never select it. A tab
 * with nothing behind it at all is not rendered; this is for a panel that
 * exists and cannot be opened yet.
 *
 * @param {{
 *   id: string,
 *   children: import('react').ReactNode,
 *   disabled?: boolean,
 *   hint?: string,     // why it is unavailable, for a screen reader
 * }} props
 */
export function Tab({ id, children, disabled = false, hint }) {
  const { baseId, value, onChange } = useTabs('Tab');
  const selected = value === id;
  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${id}`}
      aria-controls={`${baseId}-panel-${id}`}
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      tabIndex={selected ? 0 : -1}
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
