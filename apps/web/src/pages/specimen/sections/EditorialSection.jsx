// The editorial devices, one figure each.
//
// Every device under components/editorial/ appears here at least once, and
// a test reads the rendered book back to prove it. A device this page does
// not draw is a device nobody reviews in five of the six site styles.
import Callout from '../../../components/editorial/Callout.jsx';
import DefinitionList from '../../../components/editorial/DefinitionList.jsx';
import Folio from '../../../components/editorial/Folio.jsx';
import PullQuote from '../../../components/editorial/PullQuote.jsx';
import RuledTable from '../../../components/editorial/RuledTable.jsx';
import Standfirst from '../../../components/editorial/Standfirst.jsx';
import Byline, { Dateline } from '../../../components/editorial/Byline.jsx';
import LongReadOpening from '../../../components/editorial/LongReadOpening.jsx';
import Timeline from '../../../components/editorial/Timeline.jsx';
import Marginalia from '../../../components/editorial/Marginalia.jsx';
import Nameplate, { buildNameplate } from '../../../components/editorial/Nameplate.jsx';
import Plate, { PlateNumber } from '../../../components/editorial/Plate.jsx';
import RouteMark from '../../../components/editorial/RouteMark.jsx';
import Rule from '../../../components/editorial/Rule.jsx';
import SectionHead from '../../../components/editorial/SectionHead.jsx';
import SpecimenLabel from '../../../components/editorial/SpecimenLabel.jsx';
import Tag from '../../../components/editorial/Tag.jsx';
import WayfindingIcon, { WAYFINDING_ICONS } from '../../../components/editorial/WayfindingIcon.jsx';
import LeadImage from '../../../components/LeadImage.jsx';
import SessionCard from '../../../components/SessionCard.jsx';
import StatBlock from '../../../components/blocks/StatBlock.jsx';
import FactBlock from '../../../components/blocks/FactBlock.jsx';
import Figure from '../Figure.jsx';
import SpecimenSection from '../SpecimenSection.jsx';
import { useState } from 'react';
import { formatDayDate, formatSessionStart } from '../../../lib/eventTime.js';
import { EXAMPLE_SESSIONS, specimenDays, specimenSchedule, specimenTracks } from '../exampleContent.js';
import { eventConfig } from '@generated/eventConfig.js';
import { scheduleData } from '@generated/scheduleData.js';

const identity = buildNameplate(eventConfig);
const compactIdentity = buildNameplate(eventConfig, { compact: true });
// Optional fields, every one of them: an event may state no lines, no
// rooms, and no sessions yet, and each of these ran while the module was
// being imported. The book draws the event's own wherever it has them.
const TRACKS = specimenTracks(eventConfig);
const [firstSession, secondSession] =
  scheduleData.length > 1 ? scheduleData : EXAMPLE_SESSIONS;
const FOLIO_LINE = ['Day one', eventConfig.venue?.city].filter(Boolean).join(' · ');

const LEAD_IMAGE_BLOCK = Object.freeze({
  url: `${import.meta.env.BASE_URL}branding/og-default.svg`,
  alt: 'The neutral branding placeholder that ships with every deployment: a mark on a plain ground.',
  caption: 'Placeholder artwork. A client replaces it with their own picture.',
  focalX: 50,
  focalY: 50,
});

const FULL_STAT = Object.freeze({
  takeaway: 'Two thirds of the programme is hands-on',
  value: '6',
  label: 'workshops of 9 sessions',
  description: 'Sessions marked as a workshop across the three days of the programme.',
  source: 'Read from the published schedule on 14 October 2026.',
  alt: 'Six of the nine published sessions are workshops.',
});

const LEGACY_STAT = Object.freeze({ value: '3', label: 'days' });

// The facts of the event, as term and description pairs (#234). The venue
// and the days come from the snapshot where it states them; the format is
// the book's own line, because no field in config/event holds one.
const FACTS = Object.freeze([
  Object.freeze({
    term: 'Where',
    description: eventConfig.venue?.name || firstSession.location,
    note: [eventConfig.venue?.city, eventConfig.venue?.region].filter(Boolean).join(', ') || null,
  }),
  Object.freeze({
    term: 'When',
    description: `${eventConfig.days?.length || 1} ${eventConfig.days?.length === 1 ? 'day' : 'days'}`,
  }),
  Object.freeze({ term: 'Format', description: 'Workshops, panels, and peer clinics' }),
]);

const FACT_BLOCK = Object.freeze({
  blockType: 'fact',
  label: 'Who',
  value: 'Reporters, editors, and publishers from local newsrooms',
  note: 'Workshop places go to registered participants first.',
});

// The event's days as dated entries: the timeline draws real dates, never
// a sequence ornament, and the days are the dates this configuration has.
const DAY_ENTRIES = specimenDays(eventConfig).map((day) => ({
  id: day.id,
  title: day.label,
  date: day.date,
  dateLabel: formatDayDate(day, eventConfig.timezone) ?? day.date,
  body: day.startTime && day.endTime ? `Doors ${day.startTime}, close ${day.endTime}.` : undefined,
}));

// The sessions of one day, as rows a reader compares. The book sorts them
// live, because a still of a sortable head says nothing about sorting.
const { day: TABLE_DAY, sessions: TABLE_SESSIONS } = specimenSchedule(eventConfig, scheduleData);
const TABLE_COLUMNS = Object.freeze([
  Object.freeze({ id: 'title', label: 'Session', sortable: true }),
  Object.freeze({ id: 'location', label: 'Room' }),
  Object.freeze({ id: 'startTime', label: 'Starts', numeric: true, sortable: true }),
]);

function SessionTable() {
  const [sort, setSort] = useState({ column: 'startTime', direction: 'ascending' });
  const rows = [...TABLE_SESSIONS]
    .filter((session) => !session.parentId)
    .sort((left, right) => {
      const order = String(left[sort.column] ?? '').localeCompare(String(right[sort.column] ?? ''));
      return sort.direction === 'ascending' ? order : -order;
    })
    .slice(0, 5)
    .map((session) => ({
      id: session.id,
      cells: { title: session.title, location: session.location, startTime: session.startTime },
    }));
  return (
    <RuledTable
      caption={`Sessions on ${TABLE_DAY.label}`}
      columns={TABLE_COLUMNS}
      rows={rows}
      sort={sort}
      onSort={(column) =>
        setSort((current) => ({
          column,
          direction:
            current.column === column && current.direction === 'ascending' ? 'descending' : 'ascending',
        }))
      }
    />
  );
}

// The one quoted sentence a page may carry.
const QUOTE = Object.freeze({
  text: firstSession.description || eventConfig.tagline,
  attribution: firstSession.title,
});

// THREE DEVICES ARE SWITCHED OFF BY MOST STYLES, AND THE BOOK STILL HAS TO
// SHOW THEM. The plate number, the specimen label's term, and the pen mark
// each read a tier 3 display token that four of the six styles hold at
// `none` (design/tokens/components.json). Drawing the empty result would
// look like a broken figure rather than a decision, so each figure below
// sets that one token to the value a style that uses the device sets, the
// way a preset does, and its caption says which styles draw it on their
// own.
const PLATE_NUMBER_ON = Object.freeze({ '--plate-number-display': 'inline' });
// The drop cap as the two styles that open on it draw it. The contract
// defaults are the plain opening, so the cap is forced here the way a
// preset's Long read opening option forces it, and the caption says so.
const DROP_CAP_ON = Object.freeze({
  '--drop-cap-float': 'left',
  '--drop-cap-size': '3.1em',
  '--drop-cap-pad-inline-end': 'var(--space-xs)',
});
const OPENING_COPY = 'Three days to make local news work better. Compare reporting methods, build a budget that survives a thin year, and leave with a shared project plan and a partner to test it with.';
const OPENING_SECOND = 'Every session is written for people who report, edit, and run local newsrooms.';
const LABEL_KEY_ON = Object.freeze({ '--specimen-label-key-display': 'inline' });
const MARGINALIA_ON = Object.freeze({ '--marginalia-display': 'inline' });

const LABEL_FIELDS = Object.freeze([
  Object.freeze({ key: 'Room', value: firstSession.location }),
  Object.freeze({ key: 'Format', value: firstSession.type }),
  Object.freeze({ key: 'Opens', value: firstSession.startTime }),
]);

export default function EditorialSection({ folio }) {
  return (
    <SpecimenSection
      id="specimen-editorial"
      title="Editorial devices"
      folio={folio}
      standfirst="Each device has one job, and each one resolves through a tier 3 contract a site style can remap."
    >
      <Figure
        name="Nameplate"
        file="components/editorial/Nameplate.jsx"
        contract="nameplate"
        note="The rule-bounded title block. The dates and the edition line sit inside it, which is not an eyebrow."
        ground="alt"
      >
        <Nameplate
          name={identity.name}
          dates={identity.dates}
          edition={identity.edition}
          variant="full"
        />
        <div className="mt-lg">
          <Nameplate
            name={compactIdentity.name}
            dates={compactIdentity.dates}
            edition={compactIdentity.edition}
            variant="compact"
          />
        </div>
      </Figure>

      <Figure
        name="Folio"
        file="components/editorial/Folio.jsx"
        contract="folio-rule"
        note="Text on a hairline. Never a chip, and never directly above a heading."
      >
        <Folio>{FOLIO_LINE}</Folio>
        <div className="mt-md">
          <Folio rule={false}>Back issue</Folio>
        </div>
      </Figure>

      <Figure
        name="Rule"
        file="components/editorial/Rule.jsx"
        contract="--rule-*-width"
        note="The three weights again, in the order a page uses them. Section 3 measures each width."
      >
        <Rule weight="hairline" />
        <p className="my-2xs font-data text-caption text-text-secondary">Hairline</p>
        <Rule weight="strong" />
        <p className="my-2xs font-data text-caption text-text-secondary">Strong</p>
        <Rule weight="nameplate" />
        <p className="mt-2xs font-data text-caption text-text-secondary">Nameplate</p>
      </Figure>

      <Figure
        name="Section head"
        file="components/editorial/SectionHead.jsx"
        contract="section-rule"
        note="One strong rule, then the heading with the folio beside it. The folio variant makes the folio the heading, which is what a schedule day head needs."
      >
        <SectionHead title="Programme" folio="Three days" level={3} />
        <div className="mt-lg">
          <SectionHead variant="folio" title="Day two" folio="15 October" level={3} />
        </div>
      </Figure>

      <Figure
        name="Plate and plate number"
        file="components/editorial/Plate.jsx"
        contract="plate"
        note="The framed plate of a natural-history page. The number is sequence data, set as a roman numeral. Field Guide is the style that draws the number; it is switched on here so the device is visible in every style."
      >
        <Plate>
          <p className="font-data text-caption text-text-secondary" style={PLATE_NUMBER_ON}>
            <PlateNumber position={2} />
            {secondSession.title}
          </p>
        </Plate>
      </Figure>

      <Figure
        name="Specimen label"
        file="components/editorial/SpecimenLabel.jsx"
        contract="specimen-label"
        note="Term and value pairs in the data face, for a credit line or a session's facts. Field Guide is the style that prints the term; it is switched on here so both halves are visible in every style."
      >
        <div style={LABEL_KEY_ON}>
          <SpecimenLabel fields={LABEL_FIELDS} />
        </div>
      </Figure>

      <Figure
        name="Route mark"
        file="components/editorial/RouteMark.jsx"
        contract="route-mark"
        note="A track letter and its name, drawn as a line marker."
      >
        <div className="flex flex-wrap gap-md">
          {TRACKS.map((track) => (
            <RouteMark key={track.letter} letter={track.letter} name={track.name} />
          ))}
        </div>
      </Figure>

      <Figure
        name="Wayfinding icons"
        file="components/editorial/WayfindingIcon.jsx"
        contract={null}
        note="Six masks painted in the ink token. Each one carries a word beside it, because an icon never states a fact on its own."
      >
        <ul className="flex flex-wrap gap-lg">
          {WAYFINDING_ICONS.map((name) => (
            <li key={name} className="flex items-center gap-2xs">
              <WayfindingIcon name={name} />
              <span className="font-data text-caption text-text-secondary">{name}</span>
            </li>
          ))}
        </ul>
      </Figure>

      <Figure
        name="Callout"
        file="components/editorial/Callout.jsx"
        contract="callout"
        note="One quoted line. Every style but Zine holds a zero angle and the heading face, so the device is a lead line there. The pull quote below is its call site."
      >
        <Callout>{eventConfig.tagline}</Callout>
      </Figure>

      <Figure
        name="Pull quote"
        file="components/editorial/PullQuote.jsx"
        contract="pull-quote"
        note="A quoted sentence with its attribution under it, one per page at most. The sentence is the callout device, so Zine's handwritten line and every other style's ruled quote are one element; the frame around it — the rules, the opening mark, the alignment — is this contract, and the Quote device option in each style remaps both."
      >
        <div className="max-w-prose">
          <PullQuote attribution={QUOTE.attribution}>{QUOTE.text}</PullQuote>
        </div>
      </Figure>

      <Figure
        name="Definition list"
        file="components/editorial/DefinitionList.jsx"
        contract="definition-list"
        note="Term and description pairs in a real dl, ruled between pairs. This is the answer to a non-numeric fact: a venue is a term and a description, never a stat block. The term's face, case and column width are what a style moves."
      >
        <div className="max-w-prose">
          <DefinitionList items={FACTS} />
        </div>
      </Figure>

      <Figure
        name="Standfirst"
        file="components/editorial/Standfirst.jsx"
        contract="standfirst"
        note="The one sentence under a heading that says what the page is, at the lead step and never above the heading. Each style names its face and its rule."
      >
        <h3 className="font-heading text-h2 font-semibold text-text-primary">{firstSession.title}</h3>
        <Standfirst className="mt-2xs">{firstSession.description}</Standfirst>
      </Figure>

      <Figure
        name="Byline and dateline"
        file="components/editorial/Byline.jsx"
        contract="byline"
        note="Who, in what role, and when, in the data face under the title. A dateline carries the event's clock, never the reader's."
      >
        <h3 className="font-heading text-h3 font-semibold text-text-primary">{secondSession.title}</h3>
        <Byline className="mt-2xs" name="Marisol Reyes" role="opening speaker" />
        <Dateline
          className="mt-3xs"
          dateTime={`${DAY_ENTRIES[0]?.date ?? ''}T${secondSession.startTime ?? '09:00'}`}
          label={formatSessionStart(eventConfig, secondSession) ?? secondSession.startTime}
        />
      </Figure>

      <Figure
        name="Long read opening"
        file="components/editorial/LongReadOpening.jsx"
        contract="long-read"
        note="The first paragraph of a page on the Long read template takes the style's opening: a drop cap, a standfirst-sized line, or nothing. The first copy is this style's own default; the second forces the cap the way Broadsheet and Field Guide set it, so the device is visible in every style."
      >
        <div className="grid gap-lg lg:grid-cols-2">
          {[null, DROP_CAP_ON].map((forced, index) => (
            <div key={index} style={forced ?? undefined}>
              <p className="mb-xs font-data text-caption text-text-secondary">
                {forced ? 'Drop cap, forced on' : 'This style’s own opening'}
              </p>
              <LongReadOpening active>
                <div>
                  <div className="rich-text max-w-prose">
                    <p>{OPENING_COPY}</p>
                    <p>{OPENING_SECOND}</p>
                  </div>
                </div>
              </LongReadOpening>
            </div>
          ))}
        </div>
      </Figure>

      <Figure
        name="Timeline"
        file="components/editorial/Timeline.jsx"
        contract="timeline"
        note="Dated entries in order on a spine, the same spine the updates feed draws. The date sits beside the title in the mono face and is the entry's only number: nothing counts the entries and nothing is zero-padded."
      >
        <div className="max-w-prose">
          <Timeline entries={DAY_ENTRIES} level={4} />
        </div>
      </Figure>

      <Figure
        name="Ruled table"
        file="components/editorial/RuledTable.jsx"
        contract="table"
        note="A real table with row rules, tabular figures and a head that stays in view. Press a sortable head to sort: the head is a button and the column carries aria-sort. At narrow widths the table scrolls inside its own region and the page does not."
      >
        <SessionTable />
      </Figure>

      <Figure
        name="Fact block"
        file="components/blocks/FactBlock.jsx"
        contract="definition-list"
        note="The fact block, as an operator writes it: the term, the fact, and one optional line under it. It renders one pair of the definition list above and asks for no evidence field."
      >
        <dl className="definition-list max-w-prose">
          <FactBlock block={FACT_BLOCK} />
        </dl>
      </Figure>

      <Figure
        name="Marginalia"
        file="components/editorial/Marginalia.jsx"
        contract="marginalia"
        note="A pen mark in the margin. Zine and Field Guide offer it and every style ships it off, so it is switched on here to draw the three marks."
      >
        <ul className="grid gap-md sm:grid-cols-3" style={MARGINALIA_ON}>
          {['pencil', 'squiggle', 'circle'].map((mark) => (
            <li key={mark}>
              <p className="font-data text-caption text-text-secondary">{mark}</p>
              <div className="mt-2xs h-8 text-text-secondary">
                {mark === 'circle' ? (
                  <span className="marginalia-ring font-data text-caption text-text-primary">
                    Room A
                    <Marginalia mark="circle" />
                  </span>
                ) : (
                  <Marginalia mark={mark} />
                )}
              </div>
            </li>
          ))}
        </ul>
      </Figure>

      <Figure
        name="Tag"
        file="components/editorial/Tag.jsx"
        contract="--radius-base"
        note="A short word beside a title. A rectangle on the site radius, never a pill."
      >
        <div className="flex flex-wrap gap-xs">
          <Tag>{secondSession.type}</Tag>
          <Tag tone="keynote">{firstSession.type}</Tag>
        </div>
      </Figure>

      <Figure
        name="Back issue"
        file="lib/backIssue.js"
        contract="back-issue"
        note="A day whose last minute has passed. The accents drop to the archive ink and the live controls leave the document. Nothing is hidden."
      >
        <div className="back-issue" data-back-issue="true">
          <Folio rule={false}>Back issue</Folio>
          <ul className="mt-sm">
            <SessionCard
              session={firstSession}
              eventConfig={eventConfig}
              linkToDetail={false}
              backIssue
            />
          </ul>
        </div>
      </Figure>

      <Figure
        name="Lead image"
        file="components/LeadImage.jsx"
        contract="lead-image"
        note="One picture beside the opening copy. Alt text is required, or the image does not render."
      >
        <LeadImage block={LEAD_IMAGE_BLOCK} />
      </Figure>

      <Figure
        name="Stat block"
        file="components/blocks/StatBlock.jsx"
        contract={null}
        note="The four-part shape first: the finding in words, the figure, what it counts, and where it came from. The stored two-part shape follows it."
      >
        {/* A dl's div may hold only dt and dd, so the gap between the two
            blocks lives on the list itself rather than on a wrapper. */}
        <dl className="flex flex-col gap-lg">
          <StatBlock block={FULL_STAT} />
          <StatBlock block={LEGACY_STAT} />
        </dl>
      </Figure>
    </SpecimenSection>
  );
}
