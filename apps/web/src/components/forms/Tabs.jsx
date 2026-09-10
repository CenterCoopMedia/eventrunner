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

/** The row of words. */
export function TabList({ label, children }) {
  const { value, onChange, tabs, listRef } = useTabs('TabList');
  const current = Math.max(0, tabs.indexOf(value));

  function onKeyDown(event) {
    const index = nextRovingIndex(event.key, current, tabs.length);
    if (index === null) return;
    event.preventDefault();
    onChange(tabs[index]);
    listRef.current?.querySelectorAll('[role="tab"]')[index]?.focus();
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

/** One word in the row. */
export function Tab({ id, children }) {
  const { baseId, value, onChange } = useTabs('Tab');
  const selected = value === id;
  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${id}`}
      aria-controls={`${baseId}-panel-${id}`}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      onClick={() => onChange(id)}
      className={tabClass}
    >
      {children}
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
