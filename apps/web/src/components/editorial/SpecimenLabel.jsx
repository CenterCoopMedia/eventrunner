// SpecimenLabel — the collection tag (design brief §4.5; visual story,
// Field Guide).
//
// "A small ruled block that states a name, a date, and a place. It carries
// session metadata and speaker credit lines. It sits below the title it
// labels, or beside it, never above it. It is never a chip and never gets a
// pill radius."
//
// The device is TOKEN-DRIVEN. `--specimen-label-rule-width` and
// `--specimen-label-pad` are zero everywhere but Field Guide, and
// `--specimen-label-key-display` is `none`, so in the other five presets
// this renders exactly the caption line it replaced: the same words, the
// same face, the same position. Field Guide turns the rules on and sets the
// field names, and the same markup becomes a herbarium tag. No component
// here asks which theme is active.
//
// The key is the field's own name — Place, Affiliation — and it is stored
// in natural case, so a screen reader reads the word an editor would have
// written. Where the key is hidden the value still stands on its own, which
// is why a field's value must never depend on its key to make sense.

import Marginalia from './Marginalia.jsx';

/**
 * @param {{
 *   fields: Array<{ key: string, value: import('react').ReactNode } | null>,
 *   pencil?: boolean,   // the one pencil line a Field Guide page may carry
 *   className?: string,
 * }} props
 */
export default function SpecimenLabel({ fields, pencil = false, className = '' }) {
  const rows = (Array.isArray(fields) ? fields : []).filter(
    (field) => field && field.value !== null && field.value !== undefined && field.value !== '',
  );
  if (rows.length === 0) return null;
  return (
    <div className={['specimen-label', className].filter(Boolean).join(' ')}>
      {rows.map((field) => (
        <p
          key={field.key}
          className="specimen-label__field font-data text-caption text-text-secondary"
        >
          <span className="specimen-label__key">{field.key}</span>
          <span className="specimen-label__value">{field.value}</span>
        </p>
      ))}
      {pencil ? <Marginalia mark="pencil" /> : null}
    </div>
  );
}
