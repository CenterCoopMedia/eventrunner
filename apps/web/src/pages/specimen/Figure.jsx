// One specimen: the device as it renders, and the caption that names it.
//
// The caption is the reason the book is worth opening. A picture of a
// device tells a reviewer what it looks like; the caption tells them which
// file draws it and which tier 3 contract a site style remaps to change it.
// Both are needed to act on what the picture shows.
//
// `file` also lands on the element as a data attribute, so a test can read
// the whole book back and check that no device is missing.
import Rule from '../../components/editorial/Rule.jsx';

/**
 * @param {{
 *   name: string,
 *   file: string,
 *   contract?: string | null,
 *   note?: string | null,
 *   id?: string,
 *   ground?: 'page' | 'alt',
 *   children: import('react').ReactNode,
 * }} props
 */
export default function Figure({
  name,
  file,
  contract = null,
  note = null,
  id,
  ground = 'page',
  children,
}) {
  return (
    <figure id={id} data-specimen-file={file} className="mt-lg">
      <Rule weight="hairline" />
      <div
        className={
          ground === 'alt'
            ? 'bg-surface-alt px-lg py-md'
            : 'py-md'
        }
      >
        {children}
      </div>
      {/* break-words, because a component path is one long token with no
          break opportunity in it and the book must not scroll sideways at
          390px. */}
      <figcaption className="break-words font-data text-caption text-text-secondary">
        <span className="font-semibold text-text-primary">{name}</span>
        <span className="ms-2xs">·</span>{' '}
        <code className="font-mono">{file}</code>
        <span className="ms-2xs">·</span>{' '}
        {contract ? (
          <>
            Contract <code className="font-mono">{contract}</code>
          </>
        ) : (
          'Tier 2 tokens only'
        )}
        {note ? <span className="mt-3xs block max-w-prose">{note}</span> : null}
      </figcaption>
    </figure>
  );
}
