import PageHeading from '../PageHeading.jsx';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { callApi } from '../api.js';
import LoadingState from '../LoadingState.jsx';
import IconControl from '../IconControl.jsx';
import { BUILD_FAILED_LABEL, STATUS_LABELS, statusPath } from '../setup/steps.js';
import { SIGNUP_LINK_HELP } from '../text.js';

/** One organization and its event sites. Each event is its own request and its own site (ADR 0007 §2). */
export default function OrganizationHome() {
  const { orgId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setError('');
    setLoading(true);
    Promise.all([callApi('listApplications', { orgId }), callApi('getTeam', { orgId })])
      .then(([apps, team]) => { if (live) setData({ ...apps, organization: team.organization }); })
      .catch((err) => { if (live) setError(err.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [orgId, refreshKey]);

  const refresh = <IconControl icon="refresh" label="Refresh event sites" disabled={loading} onClick={() => setRefreshKey((value) => value + 1)} />;
  if (error && !data) return <div><p className="message error" role="alert">{error}</p>{refresh}</div>;
  if (!data) return <LoadingState>Loading the organization.</LoadingState>;

  return (
    <section aria-labelledby="org-title">
      <div className="directory-heading"><PageHeading id="org-title" tabIndex={-1}>{data.organization.name}</PageHeading>{refresh}</div>
      {error ? <p className="message error" role="alert">{error}</p> : null}
      <p><Link to={`/organizations/${orgId}/team`}>Team</Link></p>

      <h2 id="sites-title">Event sites</h2>
      {data.applications.length > 0 ? (
        <ul className="cards" aria-labelledby="sites-title">
          {data.applications.map((app) => (
            <li key={app.id} className="card">
              <Link to={statusPath(orgId, app.id)} className="card-title">{app.eventName || 'New event site'}</Link>
              <span className="tag">{app.buildFailed ? BUILD_FAILED_LABEL : STATUS_LABELS[app.status] || 'Status unavailable'}</span>
              {['ready', 'launched'].includes(app.status) && app.address ? <span className="muted">{app.address}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="directory-empty">
          <p>{SIGNUP_LINK_HELP}</p>
          {import.meta.env.VITE_CONSOLE_HELP_EMAIL ? <a className="button primary" href={`mailto:${import.meta.env.VITE_CONSOLE_HELP_EMAIL}`}>Get a signup link</a> : null}
        </div>
      )}
      {data.applications.length > 0 ? <p className="muted section">{SIGNUP_LINK_HELP}</p> : null}
    </section>
  );
}
