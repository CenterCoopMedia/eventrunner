// The editorial devices, one figure each.
//
// Every device under components/editorial/ appears here at least once, and
// a test reads the rendered book back to prove it. A device this page does
// not draw is a device nobody reviews in five of the six site styles.
import Callout from '../../../components/editorial/Callout.jsx';
import Folio from '../../../components/editorial/Folio.jsx';
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
import Figure from '../Figure.jsx';
import SpecimenSection from '../SpecimenSection.jsx';
import { eventConfig } from '@generated/eventConfig.js';
import { scheduleData } from '@generated/scheduleData.js';

const identity = buildNameplate(eventConfig);
const compactIdentity = buildNameplate(eventConfig, { compact: true });
const [firstSession, secondSession] = scheduleData;

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

// THREE DEVICES ARE SWITCHED OFF BY MOST STYLES, AND THE BOOK STILL HAS TO
// SHOW THEM. The plate number, the specimen label's term, and the pen mark
// each read a tier 3 display token that four of the six styles hold at
// `none` (design/tokens/components.json). Drawing the empty result would
// look like a broken figure rather than a decision, so each figure below
// sets that one token to the value a style that uses the device sets, the
// way a preset does, and its caption says which styles draw it on their
// own.
const PLATE_NUMBER_ON = Object.freeze({ '--plate-number-display': 'inline' });
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
        <Folio>Day one · {eventConfig.venue.city}</Folio>
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
          {eventConfig.tracks.map((track) => (
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
        note="One quoted line. Every style but Zine holds a zero angle and the heading face, so the device is a lead line there."
      >
        <Callout>{eventConfig.tagline}</Callout>
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
        <dl>
          <StatBlock block={FULL_STAT} />
          <div className="mt-lg">
            <StatBlock block={LEGACY_STAT} />
          </div>
        </dl>
      </Figure>
    </SpecimenSection>
  );
}
