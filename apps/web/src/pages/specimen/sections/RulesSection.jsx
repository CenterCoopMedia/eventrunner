// The three rule weights, and the nine spacing steps.
//
// A rule replaces a card border, so the three weights are the whole
// structural vocabulary of the site and a reviewer must be able to compare
// them side by side. Each band below is the step it names, drawn at its
// measured width, with the resolved value beside it.
import Rule from '../../../components/editorial/Rule.jsx';
import Figure from '../Figure.jsx';
import SpecimenSection from '../SpecimenSection.jsx';
import { useLiveToken } from '../useLiveToken.js';
import { RULE_WEIGHTS, SPACING_STEPS } from '../tokens.js';

const SPACING_CLASS = Object.freeze({
  '3xs': 'h-3xs',
  '2xs': 'h-2xs',
  xs: 'h-xs',
  sm: 'h-sm',
  md: 'h-md',
  lg: 'h-lg',
  xl: 'h-xl',
  '2xl': 'h-2xl',
  '3xl': 'h-3xl',
});

function MeasuredValue({ token }) {
  const value = useLiveToken(token);
  return <span className="font-mono text-caption text-text-secondary">{value || token}</span>;
}

export default function RulesSection({ folio }) {
  return (
    <SpecimenSection
      id="specimen-rules"
      title="Rules and spacing"
      folio={folio}
      standfirst="Three rule weights do the dividing, and nine spacing steps set every gap on the page."
    >
      <Figure
        name="Rule"
        file="components/editorial/Rule.jsx"
        contract="--rule-*-width"
        note="A rule never carries brand colour and never becomes a card border."
      >
        <dl>
          {RULE_WEIGHTS.map((entry) => (
            // A <dl>'s <div> may hold only <dt> and <dd> children (the same
            // correction LayoutSection's width bands went through), so the
            // drawn rule is the group's first <dd>: it is part of that
            // weight's description, drawn ahead of the words. Flex order
            // paints it on its own full-width line above the term, so the
            // rows read as they did before the structural fix.
            <div
              key={entry.weight}
              className="mt-md flex flex-wrap items-baseline gap-x-sm gap-y-3xs first:mt-0"
            >
              <dt className="order-2 font-data text-caption font-semibold text-text-primary">
                {entry.label}
              </dt>
              <dd aria-hidden="true" className="order-1 w-full">
                <Rule weight={entry.weight} />
              </dd>
              <dd className="order-3 font-data text-caption text-text-secondary">
                {entry.job} <MeasuredValue token={`--rule-${entry.weight}-width`} />
              </dd>
            </div>
          ))}
        </dl>
      </Figure>

      <Figure
        name="Spacing scale"
        file="design/tokens/semantic.json"
        contract={null}
        note="The gap between two groups is at least twice the gap inside one: xs pairs with md, sm with lg, md with xl."
      >
        <dl>
          {SPACING_STEPS.map((step) => (
            <div
              key={step}
              className="grid items-center gap-x-md gap-y-3xs border-t-hairline border-t-rule-hairline py-2xs sm:grid-cols-[6rem,1fr,7rem]"
            >
              <dt className="font-data text-caption text-text-primary">{step}</dt>
              <dd>
                <span
                  aria-hidden="true"
                  // A measure of space is structure, not brand: the band takes a
                  // rule colour rather than the accent, so the page keeps its
                  // colour for the things that mean something.
                  className={`${SPACING_CLASS[step]} block w-full bg-rule-strong`}
                />
              </dd>
              <dd className="sm:text-end">
                <MeasuredValue token={`--space-${step}`} />
              </dd>
            </div>
          ))}
        </dl>
      </Figure>
    </SpecimenSection>
  );
}
