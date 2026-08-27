// Motif — one named slot of the active motif set (design brief §2.3, §3.8).
//
// A motif set is a group of small drawings a preset may enable. The four
// launch slots are `section-mark`, `divider`, `nameplate-mark`, and
// `empty-state`. Field Guide ships `botanical` on, Atlas ships
// `cartographic` on, and the other four presets ship `none`.
//
// HOW IT RENDERS. Brief §3.8 allows exactly two forms, and this is the first
// of them: the slot's asset is a CSS `mask-image` and the paint is
// `background-color: rgb(var(--color-ink-motif-rgb))`. That is what lets a
// drawing inherit theme ink in both modes. An external `<img>` cannot, and a
// CSS `url()` fill cannot, so neither is ever used here.
//
// WHICH ASSET. Nothing in this component names a file, a set, or a preset.
// The generated stylesheet emits one `[data-motif-set]` block per set, each
// resolving the four slot tokens to that set's assets, and `<html>` carries
// `data-motif-set` (EventConfigProvider writes it; the admin preview frame
// carries its own). So switching sets is an attribute change, exactly like
// switching a theme — see index.css for the `.motif` rules themselves.
//
// WHEN IT RENDERS NOTHING. Under the `none` set every slot resolves to
// `none`, and index.css takes the element out of the layout entirely
// (`[data-motif-set='none'] .motif { display: none }`). That gate is CSS
// rather than JavaScript on purpose: the attribute is the switch, so a
// preview frame or a live theme switch resolves the same way the page does,
// with no second source of truth. An unknown slot name renders nothing at
// all, here.
//
// DENSITY. Brief §2.3: at most three motifs on a page. That is held by
// wiring, not by this component — the site renders a motif in three places
// only (the nameplate's mark, the nameplate's closing divider, and the
// public empty state).
//
// A motif is decorative. It is `aria-hidden`, it never carries meaning, and
// `pointer-events: none` keeps it out of the way of everything that does. A
// mark that carries meaning is an icon (see WayfindingIcon.jsx), not a
// motif.

/**
 * Slot → the class that draws it.
 *
 * Written out rather than built from the slot name, and it has to be:
 * Tailwind tree-shakes anything in `@layer components` whose class name it
 * cannot find as a literal string in the source it scans. A class assembled
 * from a template literal is not a literal string, so `motif--divider`
 * would be purged from the stylesheet — and an unmasked `.motif` paints as
 * a solid rectangle of ink, which is the worst possible way to fail.
 */
const SLOT_CLASS = Object.freeze({
  'section-mark': 'motif--section-mark',
  divider: 'motif--divider',
  'nameplate-mark': 'motif--nameplate-mark',
  'empty-state': 'motif--empty-state',
});

/** The launch slots (brief §3.8). Kept in step with design/tokens/motifs.json. */
export const MOTIF_SLOTS = Object.freeze(Object.keys(SLOT_CLASS));

/**
 * @param {{ slot: string, className?: string }} props
 */
export default function Motif({ slot, className = '' }) {
  const slotClass = SLOT_CLASS[slot];
  if (!slotClass) return null;
  return (
    <span
      aria-hidden="true"
      data-motif-slot={slot}
      className={['motif', slotClass, className].filter(Boolean).join(' ')}
    />
  );
}
