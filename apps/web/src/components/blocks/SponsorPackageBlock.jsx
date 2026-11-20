// sponsor_package: one sponsorship package (BLOCK_TYPES.sponsor_package,
// issue #193), drawn in the sponsors page's Sponsorship packages section.
//
// Built from the devices the site already has: the name is a heading under
// the section's own, the price and the limit are term and description pairs
// through the definition list, and what the package includes is rich text
// through the same sanitizer as every richtext value. No box, no card, no
// shadow: SponsorPackages sets a run of packages in a grid of entries ruled
// on top, the way every list in the system is ruled.
import { DefinitionPair } from '../editorial/DefinitionList.jsx';
import PublicRichText from '../PublicRichText.jsx';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** "Open to" words for a limit, or null when the package states none. */
export function sponsorLimitLabel(limit) {
  if (!Number.isInteger(limit) || limit < 1) return null;
  return limit === 1 ? '1 sponsor' : `${limit} sponsors`;
}

export default function SponsorPackageBlock({ block, run }) {
  if (run) return <SponsorPackages blocks={run} />;
  if (!text(block?.name)) return null;
  const price = text(block.price);
  const openTo = sponsorLimitLabel(block.limit);
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
      <PublicRichText value={block.benefits} lang={block.publicLanguage} className="rich-text mt-sm" />
    </article>
  );
}

function SponsorPackages({ blocks }) {
  return (
    <ul className="grid gap-lg sm:grid-cols-2 lg:grid-cols-3">
      {blocks.filter((block) => text(block?.name)).map((block, index) => (
        <li key={block.id ?? `${block.section}__${block.field ?? index}`} className="border-t-hairline border-t-rule-hairline pt-sm">
          <SponsorPackageBlock block={block} />
        </li>
      ))}
    </ul>
  );
}
