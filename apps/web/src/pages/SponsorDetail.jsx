import { Link, useLocation, useParams } from 'react-router-dom';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { visibleOrganizations } from '../components/SponsorWall.jsx';
import AssetImage from '../components/media/AssetImage.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ExternalLink from '../components/ExternalLink.jsx';
import { isSafeHref } from '../lib/sanitizeHtml.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { primaryActionClass } from '../components/controlClasses.js';

function paragraphs(value) {
  return typeof value === 'string' ? value.split(/\n\s*\n/).filter(Boolean) : [];
}

export default function SponsorDetail() {
  const { id } = useParams();
  const { search } = useLocation();
  const { features } = useEventConfig();
  const { organizationsData } = useContent();
  const org = features.sponsors && visibleOrganizations(organizationsData).find((item) => item.id === id);
  useDocumentTitle(org?.name);
  if (!org) return (
    <EmptyState title="This sponsor is not available" description="It may not be published yet, or the link may be out of date."
      action={<Link to={{ pathname: "/sponsors", search }} className={primaryActionClass}>Back to sponsors</Link>} />
  );
  const bio = paragraphs(org.bio || org.description);
  const support = paragraphs(org.supportDescription);
  const sessionPath = typeof org.readMorePath === 'string' && /^\/schedule\/[a-z0-9-]+$/.test(org.readMorePath)
    ? org.readMorePath : null;
  return (
    <article>
      <Link to={{ pathname: "/sponsors", search }} className="font-data text-caption text-text-secondary hover:underline">← Back to sponsors</Link>
      <header className="mt-lg">
        {org.logoPath ? <div className="mb-lg max-w-sm"><AssetImage path={org.logoPath} alt="" decorative className="sponsor-logo max-h-40 w-auto object-contain" /></div> : null}
        <p className="font-data text-caption text-text-secondary">{org.tier || 'Supporter'}</p>
        <h1 className="mt-xs font-heading text-h1 font-semibold text-text-primary">{org.name}</h1>
        {org.description ? <p className="mt-md max-w-prose text-lead text-text-secondary">{org.description}</p> : null}
      </header>
      <section className="mt-xl max-w-prose" aria-labelledby="sponsor-about">
        <h2 id="sponsor-about" className="font-heading text-h2 font-semibold">About {org.name}</h2>
        {bio.map((text, index) => <p key={index} className="mt-md text-body text-text-secondary">{text}</p>)}
      </section>
      {support.length > 0 ? <section className="mt-xl max-w-prose" aria-labelledby="sponsor-support">
        <h2 id="sponsor-support" className="font-heading text-h2 font-semibold">At the summit</h2>
        {support.map((text, index) => <p key={index} className="mt-md text-body text-text-secondary">{text}</p>)}
      </section> : null}
      <div className="mt-xl flex flex-wrap gap-md">
        {isSafeHref(org.url) ? <ExternalLink href={org.url} className={primaryActionClass}>Visit {org.name}</ExternalLink> : null}
        <Link to={{ pathname: sessionPath || '/schedule', search }} className={primaryActionClass}>{sessionPath ? 'Read about the supported session' : 'Explore the program'}</Link>
      </div>
    </article>
  );
}
