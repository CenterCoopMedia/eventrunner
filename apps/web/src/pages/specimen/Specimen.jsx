// The specimen book: every device the system has, in the style and mode on
// screen, with the file and the contract beside each one.
//
// It exists because a designer had to open real pages to see a device, and
// five of the six site styles have devices no seeded page draws. A device
// nobody can see in every style is a device nobody reviews in every style.
//
// The route is registered only in the demo build and in a development
// server (specimenRoute.js), the page marks itself noindex while it is
// mounted, and the sitemap builder refuses to list it.
//
// THE EVENT CONTENT COMES FROM THE SNAPSHOT in src/generated: the name, the
// days, the rooms, the sessions, the speakers, the sponsors. The words
// inside a control example are written for the book, because a control
// needs a label, a hint and a refusal that the snapshot has no field for.
// Nothing on the page is placeholder copy either way.
import SectionIndexNav from '../../components/SectionIndexNav.jsx';
import { SPECIMEN_SECTIONS, sectionFolio } from './sections/index.js';
import { SPECIMEN_TITLE } from './specimenRoute.js';
import useNoIndex from './useNoIndex.js';
import { useDocumentTitle } from '../../lib/useDocumentTitle.js';
import { eventConfig } from '@generated/eventConfig.js';

export default function Specimen() {
  useDocumentTitle(SPECIMEN_TITLE);
  useNoIndex();

  return (
    <article className="specimen-book">
      <h1 className="font-heading text-h1 font-semibold text-text-primary">{SPECIMEN_TITLE}</h1>
      {/* The one sentence that says what the page is, under the heading and
          never above it. */}
      <p className="mt-sm max-w-prose text-lead text-text-secondary">
        Every device in the system, drawn with content from {eventConfig.name}, in the site style
        and display mode this page is set to.
      </p>

      {/* The contents. SectionIndexNav brings its own landmark and marks
          the section the reader is in. */}
      <div className="mt-lg">
        <SectionIndexNav
          sections={SPECIMEN_SECTIONS.map((section) => ({
            id: section.id,
            label: section.label,
          }))}
        />
      </div>

      {SPECIMEN_SECTIONS.map((section, index) => (
        <section.Component key={section.id} folio={sectionFolio(index)} />
      ))}
    </article>
  );
}
