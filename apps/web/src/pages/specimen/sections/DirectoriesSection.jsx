// Section 8: four directories, four compositions, one token system.
//
// Speakers is a shelf of portraits, attendees is an index, sponsors is a
// tiered wall, and updates is a feed on a spine. None of them is a card,
// and each one is the shape its reading job needs.
//
// Two of the four have no counterpart in the committed snapshot: attendee
// profiles and updates both arrive over a live listener. So the attendee
// index draws the seeded speaker records as index rows, and the feed draws
// three seeded pages as dated entries. The copy is real snapshot copy in
// both, and each figure says which records it drew.
import { Link } from 'react-router-dom';
import SectionHead from '../../../components/editorial/SectionHead.jsx';
import SpecimenLabel from '../../../components/editorial/SpecimenLabel.jsx';
import Tag from '../../../components/editorial/Tag.jsx';
import SponsorWall from '../../../components/SponsorWall.jsx';
import { groupByLetter } from '../../Attendees.jsx';
import AssetImage from '../../../components/media/AssetImage.jsx';
import Figure from '../Figure.jsx';
import SpecimenSection from '../SpecimenSection.jsx';
import { speakers } from '@generated/scheduleData.js';
import { organizationsData } from '@generated/organizationsData.js';
import { pagesData } from '@generated/pagesData.js';
import { siteContent } from '@generated/siteContent.js';

const SHELF = speakers.slice(0, 3);
// The index's own grouping rule, not a letter chosen by hand: every
// seeded name opens with the [Demo] marker, so all three file under `#`,
// which is the rule this device exists to make visible.
const INDEX_GROUPS = groupByLetter(SHELF);

const FEED_SOURCES = Object.freeze([
  Object.freeze({
    pageId: 'guidelines',
    contentKey: 'guidelines_deadlines__bio',
    date: '2026-10-02',
    dayLabel: '2 October',
    pinned: true,
  }),
  Object.freeze({
    pageId: 'city_guide',
    contentKey: 'city_guide_around__streetcar',
    date: '2026-10-09',
    dayLabel: '9 October',
    pinned: false,
  }),
  Object.freeze({
    pageId: 'travel',
    contentKey: 'city_guide_around__rideshare',
    date: '2026-10-16',
    dayLabel: '16 October',
    pinned: false,
  }),
]);

const pageLabel = (id) => {
  const page = pagesData.find((entry) => entry.id === id);
  return page?.title || page?.label || id;
};

const feedEntries = FEED_SOURCES.map((source) => ({
  id: source.pageId,
  title: pageLabel(source.pageId),
  date: source.date,
  dayLabel: source.dayLabel,
  pinned: source.pinned,
  body: siteContent[source.contentKey]?.text ?? '',
}));

export default function DirectoriesSection() {
  return (
    <SpecimenSection
      id="specimen-directories"
      title="Directories"
      folio="Section 8"
      standfirst="Four lists, four compositions. Reading each of them is a different job, so none of them shares one shape."
    >
      <Figure
        name="Speaker shelf"
        file="pages/Speakers.jsx"
        contract="specimen-label"
        note="The portrait leads at a size a face survives. A speaker with no picture is an empty frame holding its place, never a hole in the shelf."
      >
        <ul className="portrait-shelf grid gap-x-lg sm:grid-cols-2 lg:grid-cols-3">
          {SHELF.map((speaker) => (
            <li
              key={speaker.id}
              className="portrait-shelf__plate border-t-hairline border-t-rule-hairline"
            >
              <div className="portrait-shelf__frame">
                {speaker.headshotPath ? (
                  <AssetImage path={speaker.headshotPath} alt="" className="" />
                ) : null}
              </div>
              <div className="mt-xs">
                <h3 className="font-heading text-h3 font-semibold text-text-primary">
                  {speaker.displayName}
                </h3>
                <SpecimenLabel
                  className="mt-2xs"
                  fields={[
                    { key: 'Role', value: speaker.jobTitle },
                    { key: 'At', value: speaker.organization },
                  ]}
                />
              </div>
            </li>
          ))}
        </ul>
      </Figure>

      <Figure
        name="Attendee index"
        file="pages/Attendees.jsx"
        contract={null}
        note="One compact line per person under a standing letter head. Drawn here from the three seeded speaker records, because attendee profiles reach the page over a live listener. Every seeded name opens with the demo marker, so all three file under the # head, which is what a name this alphabet does not cover gets."
      >
        <div className="attendee-index">
          {INDEX_GROUPS.map((group) => (
            <section key={group.letter}>
              <SectionHead
                className="attendee-index__letter"
                variant="folio"
                level={3}
                id={`specimen-attendee-letter-${group.letter}`}
                title={group.letter}
                rule="hairline"
                folio={group.members.length === 1 ? '1 person' : `${group.members.length} people`}
              />
              <ul>
                {group.members.map((person) => (
                  <li
                    key={person.id}
                    className="attendee-index__entry flex flex-wrap items-baseline gap-x-sm gap-y-3xs"
                  >
                    <h4 className="font-heading text-body font-semibold text-text-primary">
                      {person.displayName}
                    </h4>
                    <span className="min-w-0 font-data text-caption text-text-secondary">
                      {[person.jobTitle, person.organization].filter(Boolean).join(' · ')}
                    </span>
                    <ul className="flex flex-wrap gap-2xs">
                      <li>
                        <Tag>Speaker</Tag>
                      </li>
                    </ul>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Figure>

      <Figure
        name="Sponsor wall"
        file="components/SponsorWall.jsx"
        contract="logo-wall"
        note="The mark size carries the tier's weight, and standing comes from the operator's own ordering."
      >
        <SponsorWall
          organizations={organizationsData}
          arrangement="grid"
          level={3}
          idPrefix="specimen-tier"
        />
      </Figure>

      <Figure
        name="Updates feed"
        file="pages/Updates.jsx"
        contract={null}
        note="A hairline spine down the leading edge with a tick per entry. Drawn here from three seeded pages, because updates reach the page over a live listener."
      >
        <div className="update-feed">
          <SectionHead
            variant="folio"
            level={3}
            id="specimen-update-run"
            title="October 2026"
            rule="hairline"
          />
          <ul className="mt-sm">
            {feedEntries.map((entry) => (
              <li key={entry.id} className="update-feed__entry">
                <div className="flex flex-wrap items-baseline gap-x-sm gap-y-2xs">
                  <h4 className="font-heading text-h3 font-semibold text-text-primary">
                    <Link to="/specimen" className="hover:underline">
                      {entry.title}
                    </Link>
                  </h4>
                  {entry.pinned ? <Tag>Pinned</Tag> : null}
                </div>
                <p className="mt-3xs font-mono text-caption text-text-secondary">
                  <time dateTime={entry.date}>{entry.dayLabel}</time>
                </p>
                {entry.body ? (
                  <p className="mt-xs max-w-prose text-body text-text-secondary text-pretty">
                    {entry.body}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </Figure>
    </SpecimenSection>
  );
}
