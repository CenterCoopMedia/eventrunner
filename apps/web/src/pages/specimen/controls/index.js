// The control registry: one file per control.
//
// A control joins the book by adding one file beside this one and one line
// to the list below. The file states the control's name, the file that
// holds its shape, and how it renders in each of the six states. Nothing
// else in the book has to change.
//
// PENDING_CONTROLS is the other half of that contract. The new shared
// controls are being built beside this page, and each one lands here as a
// file when its module exists. They are named rather than imported,
// because a name is a promise a reviewer can check and an import of a
// module that does not exist is a broken build.
import primaryAction from './primaryAction.jsx';
import secondaryAction from './secondaryAction.jsx';
import quietAction from './quietAction.jsx';
import rowAction from './rowAction.jsx';

export const CONTROL_SPECIMENS = Object.freeze([
  primaryAction,
  secondaryAction,
  quietAction,
  rowAction,
]);

/**
 * The controls that have a slot but no file yet.
 *
 * `export` is the export name the module will carry, and `file` is where
 * the module lands. Add a file to this directory when one appears, import
 * it above, and delete the line here.
 */
export const PENDING_CONTROLS = Object.freeze([
  Object.freeze({ export: 'Switch', file: 'components/forms/Switch.jsx' }),
  Object.freeze({ export: 'SegmentedControl', file: 'components/forms/SegmentedControl.jsx' }),
  Object.freeze({ export: 'Tabs', file: 'components/forms/Tabs.jsx' }),
  Object.freeze({ export: 'Checkbox', file: 'components/forms/Checkbox.jsx' }),
  Object.freeze({ export: 'Radio', file: 'components/forms/Radio.jsx' }),
  Object.freeze({ export: 'SearchField', file: 'components/forms/SearchField.jsx' }),
  Object.freeze({ export: 'SortControl', file: 'components/forms/SortControl.jsx' }),
  Object.freeze({ export: 'FilterGroup', file: 'components/forms/FilterGroup.jsx' }),
]);

export default CONTROL_SPECIMENS;
