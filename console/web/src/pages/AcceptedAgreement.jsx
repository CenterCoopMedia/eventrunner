import PageHeading from '../PageHeading.jsx';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { callApi } from '../api.js';
import { statusPath } from '../setup/steps.js';
import { AgreementText } from './setup/AgreementStep.jsx';
import LoadingState from '../LoadingState.jsx';

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
      <PageHeading tabIndex={-1}>Your agreement</PageHeading>
      {error ? <p className="message error" role="alert">{error}</p> : null}
      {!data && !error ? <LoadingState>Loading the agreement.</LoadingState> : null}
      {data?.accepted ? <p className="muted">{data.accepted.name}{data.accepted.title ? `, ${data.accepted.title},` : ''} accepted this version for {data.accepted.legalName || 'your organization'}.</p> : null}
      {data?.accepted && data.agreement ? <AgreementText agreement={data.agreement} /> : null}
      {data && !data.accepted ? <p>Open your request to read and accept the agreement.</p> : null}
      <p><Link to={statusPath(orgId, appId)}>Back to your request</Link></p>
    </section>
  );
}
