import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { callApi } from '../api.js';
import { browserTimeZone } from './setup/EventStep.jsx';
import { STATUS_LABELS, STEPS, setupPath, statusPath } from '../setup/steps.js';

/**
 * One organization: its event sites and the way to start a new one. Each
 * event is its own request and its own site (ADR 0007 §2).
 */
export default function OrganizationHome() {
  const { orgId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([callApi('listApplications', { orgId }), callApi('getTeam', { orgId })])
      .then(([apps, team]) => { if (live) setData({ ...apps, organization: team.organization }); })
      .catch((err) => { if (live) setError(err.message); });
    return () => { live = false; };
  }, [orgId]);

  async function start() {
    setBusy(true);
    setError('');
    try {
      const { application } = await callApi('createApplication', { orgId, timezone: browserTimeZone() });
      navigate(setupPath(orgId, application.id, STEPS[0]));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (!data) return error ? <p className="message error" role="alert">{error}</p> : <p role="status">Loading the organization.</p>;

  return (
    <section aria-labelledby="org-title">
      <h1 id="org-title" tabIndex={-1}>{data.organization.name}</h1>
      <p><Link to={`/organizations/${orgId}/team`}>Team</Link></p>
      {error ? <p className="message error" role="alert">{error}</p> : null}

      <h2 id="sites-title">Event sites</h2>
      {data.applications.length > 0 ? (
        <ul className="cards" aria-labelledby="sites-title">
          {data.applications.map((app) => (
            <li key={app.id} className="card">
              <Link to={statusPath(orgId, app.id)} className="card-title">{app.eventName || 'New event site'}</Link>
              <span className="tag">{STATUS_LABELS[app.status] || app.status}</span>
              {app.address ? <span className="muted">{app.address}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p>No event sites yet. Answer a few questions and we make the site for you.</p>
      )}

      {data.canCreate ? (
        <p className="section">
          <button type="button" className="button primary" onClick={start} disabled={busy}>Set up a new event site</button>
        </p>
      ) : null}
      {data.myRole === 'editor' ? <p className="muted">Only an Owner can set up a new event site.</p> : null}
      {data.myRole === 'owner' && !data.canCreate ? (
        <p className="muted">An organization can have 3 open requests. Finish or withdraw one to start another.</p>
      ) : null}
    </section>
  );
}
