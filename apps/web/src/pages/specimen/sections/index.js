// The book's contents, in order.
//
// The page draws the list at the top from this array and then draws the
// sections from the same array, so the contents can never name a section
// the page does not hold.
//
// THE FOLIO IS THE POSITION IN THIS ARRAY, not a string inside each
// section. A section that inserted itself in the middle used to renumber
// twelve files by hand, and the one that was missed said "Section 4" twice.
import TypeSection from './TypeSection.jsx';
import ColourSection from './ColourSection.jsx';
import RulesSection from './RulesSection.jsx';
import LayoutSection from './LayoutSection.jsx';
import HeadersSection from './HeadersSection.jsx';
import EditorialSection from './EditorialSection.jsx';
import IllustrationsSection from './IllustrationsSection.jsx';
import ScheduleSection from './ScheduleSection.jsx';
import DirectoriesSection from './DirectoriesSection.jsx';
import ControlsSection from './ControlsSection.jsx';
import InputsSection from './InputsSection.jsx';
import FeedbackSection from './FeedbackSection.jsx';
import PrintSection from './PrintSection.jsx';

/** A section's folio, from its place in the contents. */
export function sectionFolio(index) {
  return `Section ${index + 1}`;
}

export const SPECIMEN_SECTIONS = Object.freeze([
  Object.freeze({ id: 'specimen-type', label: 'Type', Component: TypeSection }),
  Object.freeze({ id: 'specimen-colour', label: 'Colour', Component: ColourSection }),
  Object.freeze({ id: 'specimen-rules', label: 'Rules and spacing', Component: RulesSection }),
  Object.freeze({ id: 'specimen-layout', label: 'Layout', Component: LayoutSection }),
  Object.freeze({ id: 'specimen-headers', label: 'Headers', Component: HeadersSection }),
  Object.freeze({ id: 'specimen-editorial', label: 'Editorial devices', Component: EditorialSection }),
  Object.freeze({ id: 'specimen-illustrations', label: 'Illustrations', Component: IllustrationsSection }),
  Object.freeze({ id: 'specimen-schedule', label: 'Sessions and schedule', Component: ScheduleSection }),
  Object.freeze({ id: 'specimen-directories', label: 'Directories', Component: DirectoriesSection }),
  Object.freeze({ id: 'specimen-controls', label: 'Controls', Component: ControlsSection }),
  Object.freeze({ id: 'specimen-inputs', label: 'Inputs', Component: InputsSection }),
  Object.freeze({ id: 'specimen-feedback', label: 'Feedback', Component: FeedbackSection }),
  Object.freeze({ id: 'specimen-print', label: 'Print', Component: PrintSection }),
]);

export default SPECIMEN_SECTIONS;
