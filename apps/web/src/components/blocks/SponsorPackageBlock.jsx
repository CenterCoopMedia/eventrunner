// sponsor_package: one sponsorship package (BLOCK_TYPES.sponsor_package,
// issue #193), drawn in the sponsors page's Sponsorship packages section.
//
// Built from the devices the site already has: the name is a heading under
// the section's own, the price and the limit are term and description pairs
// through the definition list, and what the package includes is rich text
// through the same sanitizer as every richtext value. No box, no card, no
// shadow: SectionBlocks sets a run of packages in a grid of entries ruled
// on top, the way every list in the system is ruled.
import { DefinitionPair } from '../editorial/DefinitionList.jsx';
import { sanitizeHtml } from '../../lib/sanitizeHtml.js';

/** A string field with something in it, or null. */
function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Whether a package block has a name to head it. */
export function sponsorPackageDraws(block) {
  return Boolean(text(block?.name));
}

/** "Open to" words for a limit, or null when the package states none. */
export function sponsorLimitLabel(limit) {
  if (!Number.isInteger(limit) || limit < 1) return null;
  return limit === 1 ? '1 sponsor' : `${limit} sponsors`;
}

export default function SponsorPackageBlock({ block }) {
  if (!sponsorPackageDraws(block)) return null;
  const price = text(block.price);
  const openTo = sponsorLimitLabel(block.limit);
  const benefits = sanitizeHtml(block.benefits);
  return (
    <article>
      <h3 className="font-heading text-h3 font-semibold text-text-primary">{text(block.name)}</h3>
      {price || openTo ? (
        <dl className="definition-list mt-xs">
          {/* A price is a dynamic value, so it reads in tabular figures
              (index.css `[data-numeric]`). */}
          {price ? <DefinitionPair term="Price"><span data-numeric>{price}</span></DefinitionPair> : null}
          {openTo ? <DefinitionPair term="Open to">{openTo}</DefinitionPair> : null}
        </dl>
      ) : null}
      {benefits ? (
        <div
          className="rich-text mt-sm"
          // Sanitized above — allowlisted tags and attributes only.
          dangerouslySetInnerHTML={{ __html: benefits }}
        />
      ) : null}
    </article>
  );
}
