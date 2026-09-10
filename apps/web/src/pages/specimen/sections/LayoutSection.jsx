// The two widths every page is built on.
//
// Before them every page sat in one column the width of a text measure. At
// 1440px the event name wrapped at display size, the schedule grid, the
// portrait shelf, the logo wall and the footer were all squeezed into that
// measure, and half the canvas stayed empty — and because every style shared
// the shape, every style read as the same narrow template.
//
// There are two now, and a style retunes either one in its own preset file,
// so the shape of a page is part of what a style says rather than a constant
// underneath all six. That is why the widths belong in the book: the numbers
// below are read from the live document, so a reviewer switching the style
// control watches them move.
import { SummaryRow } from '../../Home.jsx';
import { groupIntoCards } from '../../../components/InfoCards.jsx';
import Figure from '../Figure.jsx';
import SpecimenSection from '../SpecimenSection.jsx';
import { useLiveToken } from '../useLiveToken.js';
import { STAGE_WIDTHS } from '../tokens.js';
import { eventConfig } from '@generated/eventConfig.js';
import { siteContent } from '@generated/siteContent.js';

const FACT_BLOCKS = Object.values(siteContent)
  .filter((block) => block.section === 'info')
  .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));

const FACTS = { id: 'specimen-key-facts', title: 'Key facts', cards: groupIntoCards(FACT_BLOCKS) };

function MeasuredValue({ token }) {
  const value = useLiveToken(token);
  return <span className="font-mono text-caption text-text-secondary">{value || token}</span>;
}

/**
 * One width, drawn as the band it caps, with its resolved value beside it.
 *
 * It is a real term-and-description pair: the width's name is the term, and
 * the value, the sentence and the band are its description. A `<div>` is
 * allowed inside a `<dl>`, but only around a `dt` and its `dd`s — the block
 * used to hold an `h3`, a `span` and a `p` directly, which is neither a
 * pair nor valid, and a heading is not allowed inside a `dt` either. This
 * is the shape ControlsSection's token rows already use.
 */
function WidthBand({ entry }) {
  return (
    <div className="grid gap-x-md gap-y-3xs border-t-hairline border-t-rule-hairline py-sm sm:grid-cols-[1fr,auto]">
      <dt className="font-data text-caption font-semibold text-text-primary">{entry.label}</dt>
      <dd className="sm:text-end">
        <MeasuredValue token={entry.token} />
      </dd>
      <dd className="sm:col-span-2">
        <p className="mt-2xs max-w-prose text-body text-text-secondary text-pretty">{entry.job}</p>
        <span
          aria-hidden="true"
          className="mt-sm block h-2xs bg-rule-strong"
          style={{ maxInlineSize: `var(${entry.token})` }}
        />
      </dd>
    </div>
  );
}

export default function LayoutSection({ folio }) {
  return (
    <SpecimenSection
      id="specimen-layout"
      title="Layout"
      folio={folio}
      standfirst="Two widths: a stage for the frame of the page, and a measure for the text a person reads."
    >
      <Figure
        name="Stage and measure"
        file="design/tokens/semantic.json"
        contract="page"
        note="The stage is what the header, the navigation, the schedule grid, the directories, the logo wall and every section head run to. The measure is running text, and it never exceeds the stage. Both are maximums, never fixed widths, so a narrow viewport gets the whole stage."
      >
        <dl>
          {STAGE_WIDTHS.map((entry) => (
            <WidthBand key={entry.token} entry={entry} />
          ))}
        </dl>
      </Figure>

      <Figure
        name="Margin column"
        file="apps/web/src/index.css"
        contract="page"
        note="At lg and above the stage becomes two tracks: the measure takes the leading one and a margin opens beside it, which is where a folio, a picture or a line of metadata may sit. Below lg the margin closes and the measure fills the stage."
      >
        <div className="stage-split">
          <div>
            <p className="max-w-prose text-body text-text-primary text-pretty">
              {eventConfig.tagline}
            </p>
            <p className="mt-sm max-w-prose text-body text-text-secondary text-pretty">
              Running text sits in the leading track and stops at the measure, so a line never runs
              past the length a reader can follow back to the start of the next one.
            </p>
          </div>
          <p className="font-data text-caption text-text-secondary">
            {eventConfig.venue.name}
            <br />
            {eventConfig.venue.city}, {eventConfig.venue.region}
          </p>
        </div>
      </Figure>

      <Figure
        name="Composed first screen"
        file="pages/Home.jsx"
        contract="page"
        note="The home page opens on one composed moment: the dates, the key facts and the clock as three equal cells across the stage, each with its own head, separated by a hairline in the gutter. It is not a bento grid and it is not a set of cards — no cell has a ground, a border, a radius or a shadow of its own, and every cell holds real content. A cell with nothing to say is not drawn, so the row is a row of two or of one where the event has not recorded its days."
      >
        <SummaryRow
          days={eventConfig.days}
          timezone={eventConfig.timezone}
          eventConfig={eventConfig}
          facts={FACTS}
        />
      </Figure>
    </SpecimenSection>
  );
}
