import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { callApi } from '../api.js';
import { ROLE_LABELS, formatDate } from '../text.js';

/** The home page: my organizations, and every organization for the hosting team. */
export default function Organizations() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    callApi('listOrganizations', {})
      .then((body) => { if (live) setData(body); })
      .catch((err) => { if (live) setError(err.message); });
    return () => { live = false; };
  }, []);

  if (error) return <p className="message error" role="alert">{error}</p>;
  if (!data) return <p role="status">Loading your organizations.</p>;
  if (!data.operator && data.organizations.length === 0) return <Navigate to="/organizations/new" replace />;

  return (
    <section aria-labelledby="orgs-title">
      <h1 id="orgs-title" tabIndex={-1}>Your organizations</h1>
      {data.organizations.length > 0 ? (
        <ul className="cards">
          {data.organizations.map((org) => (
            <li key={org.id} className="card row">
              <Link to={`/organizations/${org.id}/team`} className="card-title">{org.name}</Link>
              <span className="tag">{ROLE_LABELS[org.role] || org.role}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p>You are not on the team of any organization.</p>
      )}
      <p><Link to="/organizations/new">Add another organization</Link></p>

      {data.operator ? (
        <section aria-labelledby="all-orgs-title" className="section">
          <h2 id="all-orgs-title">All organizations</h2>
          <p className="muted">You are on the hosting team, so you can see every organization. You cannot change their teams.</p>
          <ul className="cards">
            {(data.allOrganizations || []).map((org) => (
              <li key={org.id} className="card row">
                <Link to={`/organizations/${org.id}/team`} className="card-title">{org.name}</Link>
                <span className="muted">Created {formatDate(org.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
