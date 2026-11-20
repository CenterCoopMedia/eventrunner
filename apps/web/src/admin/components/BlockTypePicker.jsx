// Choose a block type by what it looks like on the site (issue #1153).
//
// Each option draws a small example through the public block renderers, in
// the site's saved theme, so a person picks "the thing with a picture"
// rather than a type name. The examples are pictures only: the frame is
// inert, so its links and details cannot take focus or navigate. The radio
// beside each one is the control.
//
// Types the section does not take stay listed, disabled, with the reason,
// so nobody has to guess why a familiar option is missing.
import { memo, useId, useState } from 'react';
import SectionBlocks from '../../components/blocks/SectionBlocks.jsx';
import Timeline from '../../components/editorial/Timeline.jsx';
import WayfindingIcon from '../../components/editorial/WayfindingIcon.jsx';
import { usePublicThemeScope } from '../usePublicThemeScope.js';
import { BLOCK_TYPE_IDS, blockTypeFor, blockTypeLabel } from '../blockTypes.js';
import './blockTypePicker.css';

/** One plain line per type, in the words staff use. */
export const BLOCK_TYPE_SUMMARIES = Object.freeze({
  text: 'One line of plain text, such as a heading. No links or formatting.',
  richtext: 'Paragraphs with links, bold, italics and lists.',
  image: 'A picture from the media library.',
  map: 'An interactive street map for the event venue or another place.',
  cta: 'A button that takes readers to another page.',
  stat: 'A number with its caption and where it came from.',
  fact: 'A term and its detail, such as Where or Who.',
  quote: 'A quoted sentence and who said it.',
  list_item: 'One point in a bulleted list.',
  faq_item: 'A question with its answer.',
  link_group: 'One link in a named group, such as footer links.',
  gallery: 'Several pictures as a grid, a carousel or a slideshow.',
  latest_updates: 'Links to the newest published posts.',
  sponsor_package: 'A sponsorship level with its price and benefits.',
  timeline: 'Past editions in order, with optional links and images.',
});

const SAMPLE_BLOCKS = Object.freeze({
  text: { value: 'Welcome to the summit' },
  richtext: { value: '<p>Two days of talks and workshops for <strong>local newsrooms</strong>.</p>' },
  image: { url: 'demo/summit-gathering.webp', alt: '' },
  cta: { label: 'See the program', url: '/schedule' },
  stat: {
    value: '420',
    label: 'Attendees expected',
    takeaway: 'Up this year',
    description: 'Registrations by the opening day.',
    source: 'Registration list',
    alt: '420 attendees expected',
  },
  fact: { label: 'Where', value: 'The main hall', note: '1 Example Street' },
  quote: { text: 'Local news is work we do together.', attribution: 'A speaker' },
  list_item: { text: 'Hands-on workshops' },
  faq_item: { question: 'Is there parking?', answer: '<p>Yes, free on site.</p>' },
  link_group: { group: 'Resources', label: 'Travel guide', url: '/travel' },
  gallery: {
    layout: 'grid',
    images: [
      { url: 'demo/summit-gathering.webp', alt: 'Attendees at the summit' },
      { url: 'demo/speakers/amara-okafor.webp', alt: 'A speaker' },
      { url: 'demo/speakers/devon-achebe.webp', alt: 'A speaker' },
    ],
  },
  latest_updates: {
    updates: [
      { id: 'program', title: 'The program is out' },
      { id: 'venue', title: 'Getting to the venue' },
    ],
  },
  sponsor_package: { name: 'Gold', price: '$2,500', limit: 3, benefits: '<p>Logo on every page</p>' },
});

const TIMELINE_EXAMPLE = [
  { id: 'first-gathering', title: 'First gathering', date: '2022', dateLabel: '2022' },
  { id: 'community-workshops', title: 'Community workshops', date: '2025', dateLabel: '2025' },
];

// Memoized: the examples never change, and the editor re-renders on every
// keystroke in the fields below.
const Example = memo(function Example({ typeId }) {
  const sample = SAMPLE_BLOCKS[typeId];
  let example;
  if (typeId === 'map') {
    example = (
      <div className="flex items-center gap-xs bg-surface-alt p-md">
        <WayfindingIcon name="venue" />
        <span>1 Example Street</span>
      </div>
    );
  } else if (typeId === 'timeline') {
    example = <Timeline entries={TIMELINE_EXAMPLE} />;
  } else if (sample) {
    example = <SectionBlocks blocks={[{ id: `example-${typeId}`, section: 'example', field: typeId, blockType: typeId, ...sample }]} />;
  } else {
    return null;
  }
  return (
    <div className="admin-block-picker__example" inert="" aria-hidden="true">
      {example}
    </div>
  );
});

/**
 * @param {{
 *   value: string,
 *   onChange: (id: string) => void,
 *   allowed?: string[],
 *   savedType?: string,
 *   sectionName?: string,
 *   error?: string,
 * }} props
 */
export default function BlockTypePicker({ value, onChange, allowed = [], savedType, sectionName, error }) {
  const name = useId();
  const errorId = `${name}-error`;
  const [grid, setGrid] = useState(null);
  // Short text is offered only where Text is not (issue #1184): Text takes
  // links and emphasis, and staff found Short text could not. A block that
  // is Short text already keeps it, and can be switched to Text and back
  // until the change is saved.
  const sectionTakes = allowed.length ? allowed : BLOCK_TYPE_IDS;
  const keepsText = value === 'text' || savedType === 'text';
  const takes = !keepsText && sectionTakes.includes('richtext')
    ? sectionTakes.filter((id) => id !== 'text')
    : sectionTakes;
  // What the section takes comes first; the rest follow, disabled.
  const offered = BLOCK_TYPE_IDS.filter((id) => id !== 'text' || takes.includes('text') || !sectionTakes.includes('text'));
  const ordered = [...offered.filter((id) => takes.includes(id) || id === value), ...offered.filter((id) => !takes.includes(id) && id !== value)];
  const listed = value && !BLOCK_TYPE_IDS.includes(value) ? [value, ...ordered] : ordered;
  const words = takes.map((id) => blockTypeLabel(id).toLowerCase());
  const names = words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0];
  const reason = `${sectionName || 'This section'} takes only ${names}.`;

  // The site's theme reaches the examples only. Admin controls read admin
  // tokens, which the theme never sets, so the radios keep the admin look.
  usePublicThemeScope(grid, 'admin-block-examples');

  return (
    <fieldset className="admin-block-picker" aria-describedby={error ? errorId : undefined}>
      <legend className="admin-block-picker__legend">Block type</legend>
      <div ref={setGrid} className="admin-block-picker__grid">
        {listed.map((id) => {
          const disabled = !takes.includes(id) && id !== value;
          const inputId = `${name}-${id}`;
          return (
            <label key={id} htmlFor={inputId} className="admin-block-picker__option" data-selected={id === value || undefined} data-disabled={disabled || undefined}>
              <span className="admin-block-picker__head">
                <input data-help-skip="Each option shows an example and a one-line description."
                  id={inputId}
                  type="radio"
                  name={name}
                  value={id}
                  checked={id === value}
                  disabled={disabled}
                  aria-labelledby={`${inputId}-name`}
                  aria-describedby={`${inputId}-summary`}
                  onChange={() => onChange(id)}
                />
                <span id={`${inputId}-name`} className="admin-block-picker__name">{blockTypeFor(id)?.label ?? 'Content block'}</span>
              </span>
              <Example typeId={id} />
              <span id={`${inputId}-summary`} className="admin-block-picker__summary">
                {disabled ? reason : BLOCK_TYPE_SUMMARIES[id] ?? ''}
              </span>
            </label>
          );
        })}
      </div>
      {error ? <p id={errorId} className="admin-block-picker__error">{error}</p> : null}
    </fieldset>
  );
}
