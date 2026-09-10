// Section 2: every tier 2 colour token, measured against the page ground.
//
// The swatch is a ruled band rather than a chip, and the number beside it
// is measured in this document, in this mode, at this moment. A number
// written into the page would be a claim about one style; a number read
// from the document is a fact about the one on screen.
//
// Text needs 4.5:1 and a control boundary needs 3:1. The page states which
// bar each row must clear so a reviewer can read the column and stop.
import Figure from '../Figure.jsx';
import SpecimenSection from '../SpecimenSection.jsx';
import { useLiveContrast, useLiveToken } from '../useLiveToken.js';
import { COLOUR_GROUPS, formatContrast } from '../tokens.js';

function SwatchRow({ token }) {
  const value = useLiveToken(token);
  const ratio = useLiveContrast(token);

  return (
    <div className="grid gap-x-md gap-y-3xs border-t-hairline border-t-rule-hairline py-sm sm:grid-cols-[3rem,1fr,7rem]">
      <span
        aria-hidden="true"
        className="h-6 w-full border-hairline border-rule-hairline sm:h-full"
        style={{ backgroundColor: `rgb(var(${token}))` }}
      />
      <span className="break-words font-mono text-caption text-text-primary">
        {token}
        <span className="ms-sm text-text-secondary">{value || 'no value here'}</span>
      </span>
      <span className="font-data text-caption text-text-secondary sm:text-end">
        {formatContrast(ratio)}
      </span>
    </div>
  );
}

export default function ColourSection() {
  return (
    <SpecimenSection
      id="specimen-colour"
      title="Colour"
      folio="Section 2"
      standfirst="Every tier 2 colour token, with the contrast it holds against the page ground in the style and mode on screen."
    >
      <p className="mt-sm max-w-prose text-body text-text-secondary">
        Each ratio is measured in this document, against the page ground token
        <code className="ms-2xs font-mono">--color-surface-rgb</code>.
      </p>

      {COLOUR_GROUPS.map((group) => (
        <Figure
          key={group.id}
          name={group.title}
          file="design/tokens/semantic.json"
          contract={null}
          note={group.note}
        >
          <div>
            {group.tokens.map((token) => (
              <SwatchRow key={token} token={token} />
            ))}
          </div>
        </Figure>
      ))}
    </SpecimenSection>
  );
}
