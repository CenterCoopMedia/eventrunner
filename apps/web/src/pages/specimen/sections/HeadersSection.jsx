// The four header treatments, each with the seeded identity.
//
// Every treatment carries the identity and the navigation, and none of
// them is a heading: the page's own h1 is at the top of this book. The
// navigation here is a short standing list, so the four treatments can be
// compared on the identity rather than on how many links a site has.
import { Link } from 'react-router-dom';
import Header from '../../../components/Header.jsx';
import { buildNameplate } from '../../../components/editorial/Nameplate.jsx';
import Figure from '../Figure.jsx';
import SpecimenSection from '../SpecimenSection.jsx';
import { eventConfig } from '@generated/eventConfig.js';

const TREATMENTS = Object.freeze([
  Object.freeze({
    variant: 'standard',
    label: 'Standard',
    note: 'The base. The identity is present and the page headline leads.',
  }),
  Object.freeze({
    variant: 'masthead',
    label: 'Masthead',
    note: 'The nameplate at full size, for a front page or a single-day event.',
  }),
  Object.freeze({
    variant: 'compact',
    label: 'Compact',
    note: 'The nameplate at running-header size: short name and dates on one baseline.',
  }),
  Object.freeze({
    variant: 'minimal',
    label: 'Minimal',
    note: 'The mark and the navigation, with the name read out to a screen reader. A deployment with no mark falls back to the name in view.',
  }),
]);

const NAV_ITEMS = Object.freeze(['Schedule', 'Speakers', 'Sponsors']);

// The seeded deployment's own mark, resolved against the build's base the
// way the shell resolves it. Passing it makes the minimal treatment draw
// what it is for: the mark, not the name standing in for one.
const MARK_SRC = `${import.meta.env.BASE_URL}branding/mark.svg`;

function HeaderMark({ size }) {
  return <img src={MARK_SRC} alt="" width={size} height={size} className="shrink-0" />;
}

function SpecimenNav() {
  return (
    <ul className="flex flex-wrap gap-x-md gap-y-2xs">
      {NAV_ITEMS.map((item) => (
        <li key={item}>
          <Link
            to="/specimen"
            className="font-data text-caption font-medium text-text-primary hover:underline"
          >
            {item}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function HeadersSection({ folio }) {
  const identity = buildNameplate(eventConfig);
  const compact = buildNameplate(eventConfig, { compact: true });

  return (
    <SpecimenSection
      id="specimen-headers"
      title="Headers"
      folio={folio}
      standfirst="Four treatments, one identity. A site picks one, and a page may state its own."
    >
      {TREATMENTS.map((treatment) => (
        <Figure
          key={treatment.variant}
          name={`${treatment.label} header`}
          file="components/Header.jsx"
          contract="nameplate"
          note={treatment.note}
          ground="alt"
        >
          <Header
            variant={treatment.variant}
            name={treatment.variant === 'compact' ? compact.name : identity.name}
            dates={identity.dates}
            place={identity.edition}
            to="/specimen"
            mark={<HeaderMark size={treatment.variant === 'masthead' ? 40 : 28} />}
          >
            <SpecimenNav />
          </Header>
        </Figure>
      ))}
    </SpecimenSection>
  );
}
