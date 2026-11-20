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
import { memo, useEffect, useId, useRef, useState } from 'react';
import SectionBlocks from '../../components/blocks/SectionBlocks.jsx';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { applyThemePreview, releaseThemePreviewTarget } from '../themePreview.js';
import { BLOCK_TYPE_IDS, blockTypeFor, blockTypeLabel } from '../blockTypes.js';
import './blockTypePicker.css';

/** One plain line per type, in the words staff use. */
export const BLOCK_TYPE_SUMMARIES = Object.freeze({
  text: 'A heading, label or one line of copy.',
  richtext: 'One or more paragraphs, with bold text, links and lists.',
  image: 'A picture from the media library.',
  cta: 'A button that takes readers to another page.',
  stat: 'A number with its caption and where it came from.',
  fact: 'A term and its detail, such as Where or Who.',
  quote: 'A quoted sentence and who said it.',
  list_item: 'One point in a bulleted list.',
  faq_item: 'A question with its answer.',
  link_group: 'One link in a named group, such as footer links.',
  sponsor_package: 'A sponsorship level with its price and benefits.',
});

function prefersDarkNow() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

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
  sponsor_package: { name: 'Gold', price: '$2,500', limit: 3, benefits: '<p>Logo on every page</p>' },
});

// Memoized: the examples never change, and the editor re-renders on every
// keystroke in the fields below.
const Example = memo(function Example({ typeId }) {
  const sample = SAMPLE_BLOCKS[typeId];
  if (!sample) return null;
  return (
    <div className="admin-block-picker__example" inert="" aria-hidden="true">
      <SectionBlocks blocks={[{ id: `example-${typeId}`, section: 'example', field: typeId, blockType: typeId, ...sample }]} />
    </div>
  );
});

/**
 * @param {{
 *   value: string,
 *   onChange: (id: string) => void,
 *   allowed?: string[],
 *   sectionName?: string,
 *   error?: string,
 * }} props
 */
export default function BlockTypePicker({ value, onChange, allowed = [], sectionName, error }) {
  const { publicTheme: theme } = useEventConfig();
  const name = useId();
  const errorId = `${name}-error`;
  const gridRef = useRef(null);
  const takes = allowed.length ? allowed : BLOCK_TYPE_IDS;
  // What the section takes comes first; the rest follow, disabled.
  const ordered = [...BLOCK_TYPE_IDS.filter((id) => takes.includes(id) || id === value), ...BLOCK_TYPE_IDS.filter((id) => !takes.includes(id) && id !== value)];
  const listed = value && !BLOCK_TYPE_IDS.includes(value) ? [value, ...ordered] : ordered;
  const words = takes.map((id) => blockTypeLabel(id).toLowerCase());
  const names = words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0];
  const reason = `${sectionName || 'This section'} takes only ${names}.`;

  // The site's theme reaches the examples only. Admin controls read admin
  // tokens, which the theme never sets, so the radios keep the admin look.
  // A theme that follows the system mode is applied again when the system
  // mode changes, as the public page does.
  const [systemDark, setSystemDark] = useState(() => prefersDarkNow());
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!query) return undefined;
    const change = () => setSystemDark(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    const grid = gridRef.current;
    if (!theme || !grid) return undefined;
    applyThemePreview(theme, { scopes: [{ element: grid, id: 'admin-block-examples' }] });
    return () => releaseThemePreviewTarget(grid);
  }, [theme, systemDark]);

  return (
    <fieldset className="admin-block-picker" aria-describedby={error ? errorId : undefined}>
      <legend className="admin-block-picker__legend">Block type</legend>
      <div ref={gridRef} className="admin-block-picker__grid">
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
