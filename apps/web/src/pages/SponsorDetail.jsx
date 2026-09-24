// A sponsor's own page (issue #193), at `/sponsors/:slug`. The slug is the
// organization's document id, which the admin editor sets once from the
// name (functions/src/cms/organizations.cjs).
//
// The header holds the logo, the name, the description as the standfirst
// under it, and the tier as a term and its description. Nothing is set
// above the name: the tier used to sit there as a line of small type, which
// is an eyebrow. The About section draws only when the record has a
// biography, so the description never prints twice.
import { Link, useLocation, useParams } from 'react-router-dom';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { visibleOrganizations } from '../components/SponsorWall.jsx';
import AssetImage from '../components/media/AssetImage.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ExternalLink from '../components/ExternalLink.jsx';
import Standfirst from '../components/editorial/Standfirst.jsx';
import { DefinitionPair } from '../components/editorial/DefinitionList.jsx';
import { isSafeHref } from '../lib/sanitizeHtml.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { primaryActionClass } from '../components/controlClasses.js';

function paragraphs(value) {
  return typeof value === 'string' ? value.split(/\n\s*\n/).filter(Boolean) : [];
}

export default function SponsorDetail() {
  const { slug } = useParams();
  const { search } = useLocation();
  const { features } = useEventConfig();
  const { organizationsData, scheduleData = [] } = useContent();
  const org = features.sponsors && visibleOrganizations(organizationsData).find((item) => item.id === slug);
  useDocumentTitle(org?.name);
  if (!org) return (
    <EmptyState title="This sponsor is not available" description="It may not be published yet, or the link may be out of date."
      action={<Link to={{ pathname: "/sponsors", search }} className={primaryActionClass}>Back to sponsors</Link>} />
  );
  const bio = paragraphs(org.bio);
  const tier = typeof org.tier === 'string' && org.tier.trim() ? org.tier.trim() : null;
  const support = paragraphs(org.supportDescription);
  const requestedSessionPath = typeof org.readMorePath === 'string' && /^\/schedule\/[a-z0-9-]+$/.test(org.readMorePath)
    ? org.readMorePath : null;
  const sessionPath = requestedSessionPath && scheduleData.some((session) =>
    `/schedule/${session.id}` === requestedSessionPath && session.visible === true)
    ? requestedSessionPath : null;
  return (
    <article>
      <Link to={{ pathname: "/sponsors", search }} className="font-data text-caption text-text-secondary hover:underline">← Back to sponsors</Link>
      <header className="mt-lg">
        {org.logoPath ? <div className="mb-lg max-w-sm"><AssetImage path={org.logoPath} alt="" decorative className="sponsor-logo max-h-40 w-auto object-contain" /></div> : null}
        <h1 className="font-heading text-h1 font-semibold text-text-primary">{org.name}</h1>
        {org.description ? <Standfirst className="mt-md">{org.description}</Standfirst> : null}
        {tier ? <dl className="definition-list mt-md max-w-prose"><DefinitionPair term="Tier">{tier}</DefinitionPair></dl> : null}
      </header>
      {bio.length > 0 ? <section className="mt-xl max-w-prose" aria-labelledby="sponsor-about">
        <h2 id="sponsor-about" className="font-heading text-h2 font-semibold">About {org.name}</h2>
        {bio.map((text, index) => <p key={index} className="mt-md text-body text-text-secondary">{text}</p>)}
      </section> : null}
      {support.length > 0 ? <section className="mt-xl max-w-prose" aria-labelledby="sponsor-support">
        <h2 id="sponsor-support" className="font-heading text-h2 font-semibold">At the summit</h2>
        {support.map((text, index) => <p key={index} className="mt-md text-body text-text-secondary">{text}</p>)}
      </section> : null}
      <div className="mt-xl flex flex-wrap gap-md">
        {isSafeHref(org.url) ? <ExternalLink href={org.url} className={primaryActionClass}>Visit {org.name}</ExternalLink> : null}
        {features.schedule ? <Link to={{ pathname: sessionPath || '/schedule', search }} className={primaryActionClass}>{sessionPath ? 'Read about the supported session' : 'Explore the program'}</Link> : null}
      </div>
    </article>
  );
}
