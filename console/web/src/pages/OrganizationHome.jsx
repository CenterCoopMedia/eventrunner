import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { callApi } from '../api.js';
import LoadingState from '../LoadingState.jsx';
import { BUILD_FAILED_LABEL, STATUS_LABELS, statusPath } from '../setup/steps.js';
import { SIGNUP_LINK_HELP } from '../text.js';

/** One organization and its event sites. Each event is its own request and its own site (ADR 0007 §2). */
export default function OrganizationHome() {
  const { orgId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    Promise.all([callApi('listApplications', { orgId }), callApi('getTeam', { orgId })])
      .then(([apps, team]) => { if (live) setData({ ...apps, organization: team.organization }); })
      .catch((err) => { if (live) setError(err.message); });
    return () => { live = false; };
  }, [orgId]);

  if (error) return <p className="message error" role="alert">{error}</p>;
  if (!data) return <LoadingState>Loading the organization.</LoadingState>;

  return (
    <section aria-labelledby="org-title">
      <h1 id="org-title" tabIndex={-1}>{data.organization.name}</h1>
      <p><Link to={`/organizations/${orgId}/team`}>Team</Link></p>

      <h2 id="sites-title">Event sites</h2>
      {data.applications.length > 0 ? (
        <ul className="cards" aria-labelledby="sites-title">
          {data.applications.map((app) => (
            <li key={app.id} className="card">
              <Link to={statusPath(orgId, app.id)} className="card-title">{app.eventName || 'New event site'}</Link>
              <span className="tag">{app.buildFailed ? BUILD_FAILED_LABEL : STATUS_LABELS[app.status] || app.status}</span>
              {['ready', 'launched'].includes(app.status) && app.address ? <span className="muted">{app.address}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p>No event sites yet.</p>
      )}
      <p className="muted section">{SIGNUP_LINK_HELP}</p>
    </section>
  );
}
