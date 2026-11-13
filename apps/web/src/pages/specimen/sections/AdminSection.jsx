import { useHref } from 'react-router';
import { ADMIN_SPECIMEN_PATH } from '../specimenRoute.js';
import Figure from '../Figure.jsx';
import SpecimenSection from '../SpecimenSection.jsx';

export default function AdminSection({ folio }) {
  const src = useHref(`/${ADMIN_SPECIMEN_PATH}`);
  return (
    <SpecimenSection id="specimen-admin" title="Admin devices" folio={folio}
      standfirst="The fixed Admin typography and house colours, with synthetic accounts, messages and invoices. The separate document keeps the public book's style intact.">
      <Figure name="Interactive Admin specimen" file="pages/specimen/AdminSpecimen.jsx" contract="admin-*"
        note="All nine device families use their real presentation. Example actions stay in this document and never read or save records.">
        <p className="mb-sm"><a href={src} target="_blank" rel="noopener noreferrer" className="text-link underline">Open the Admin specimen in a new window</a></p>
        <iframe title="Interactive Admin device specimens" src={src} loading="lazy" height="960" className="block w-full" />
      </Figure>
    </SpecimenSection>
  );
}
