import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { callApi } from '../api.js';
import { statusPath } from '../setup/steps.js';
import { AgreementText } from './setup/AgreementStep.jsx';

/** The version this request accepted, to read again at any time. */
export default function AcceptedAgreement() {
  const { orgId, appId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    callApi('getAgreement', { orgId, appId }).then(setData, (err) => setError(err.message));
  }, [orgId, appId]);

  return (
    <section className="stack">
      <h1 tabIndex={-1}>Your agreement</h1>
      {error ? <p className="message error" role="alert">{error}</p> : null}
      {!data && !error ? <p role="status">Loading the agreement.</p> : null}
      {data?.accepted ? <p className="muted">{data.accepted.name}{data.accepted.title ? `, ${data.accepted.title},` : ''} accepted this version for {data.accepted.legalName || 'your organization'}.</p> : null}
      {data?.accepted && data.agreement ? <AgreementText agreement={data.agreement} /> : null}
      {data && !data.accepted ? <p>Nobody has accepted the agreement on this request yet.</p> : null}
      <p><Link to={statusPath(orgId, appId)}>Back to your request</Link></p>
    </section>
  );
}
