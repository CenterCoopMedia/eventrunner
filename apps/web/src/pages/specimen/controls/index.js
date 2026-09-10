// The control registry: one file per control.
//
// A control joins the book by adding one file beside this one and one line
// to the list below. The file states the control's name, the file that
// holds its shape, the states it draws, the states it does not have and
// why, and how it renders in each state it draws. Nothing else in the book
// has to change.
//
// THE LIST IS COMPLETE. It was written with a `PENDING_CONTROLS` half while
// the eight shared controls were being built beside this page; every one of
// them now has a module and a file here, so the promise half is gone. A
// control added to `components/forms/` and left out of this list is what
// `index.test.js` fails on.
import primaryAction from './primaryAction.jsx';
import secondaryAction from './secondaryAction.jsx';
import quietAction from './quietAction.jsx';
import rowAction from './rowAction.jsx';
import chipAction from './chipAction.jsx';
import switchControl from './switchControl.jsx';
import segmentedControl from './segmentedControl.jsx';
import tabsControl from './tabsControl.jsx';
import checkboxControl from './checkboxControl.jsx';
import radioControl from './radioControl.jsx';
import searchFieldControl from './searchFieldControl.jsx';
import sortControlControl from './sortControlControl.jsx';
import filterGroupControl from './filterGroupControl.jsx';

/**
 * The shared shapes first, because they carry the hover, focus and press of
 * the grammar that every control below composes. Then the controls that
 * hold a value or a choice, in the order the record §3.3 names them.
 */
export const CONTROL_SPECIMENS = Object.freeze([
  primaryAction,
  secondaryAction,
  quietAction,
  rowAction,
  chipAction,
  switchControl,
  segmentedControl,
  tabsControl,
  checkboxControl,
  radioControl,
  searchFieldControl,
  sortControlControl,
  filterGroupControl,
]);

export default CONTROL_SPECIMENS;
