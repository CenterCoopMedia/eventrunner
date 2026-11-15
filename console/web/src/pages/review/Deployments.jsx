import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { callApi } from '../../api.js';
import PageHeading from '../../PageHeading.jsx';
import LoadingState from '../../LoadingState.jsx';
import { formatDateTime } from '../../reviewText.js';
import HostingOnly, { isNotOperator } from './HostingOnly.jsx';

function elapsed(start, at) {
  const value = Date.parse(start);
  if (!Number.isFinite(value)) return 'Start time unavailable';
  const minutes = Math.max(0, Math.floor((Date.parse(at) - value) / 60_000));
  return minutes < 1 ? 'Less than a minute' : `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function RunList({ runs }) {
  return runs.length ? <ul>{runs.map((run) => <li key={run.id}>
    <a href={run.url} target="_blank" rel="noreferrer">Run {run.id}</a>{' — '}{run.conclusion || run.status}{' · '}{formatDateTime(run.startedAt)}
  </li>)}</ul> : <p>No deploys for this site on this history page.</p>;
}

function Site({ site, checkedAt, nextPage, disabled, onAction }) {
  const [confirm, setConfirm] = useState('');
  const [history, setHistory] = useState([]);
  const [page, setPage] = useState(nextPage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  useEffect(() => { setPage(nextPage); }, [nextPage]);
  const build = site.build;
  const step = build?.steps?.at(-1);
  async function older() {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError('');
    try {
      const result = await callApi('deploymentHistory', { appId: site.id, page });
      setHistory((rows) => [...rows, ...result.runs]);
      setPage(result.nextPage);
    } catch (err) { setError(err.message); }
    finally { inFlight.current = false; setLoading(false); }
  }
  return <li className="card">
    <h2><Link to={`/review/${site.id}`}>{site.eventName}</Link></h2>
    <p>{site.environment || 'Hosting is being prepared'}</p>
    {build?.state === 'running' ? <p>{step?.label || 'Starting the build'} · {elapsed(build.startedAt, checkedAt)}</p> : <p>Build: {build?.state || 'Waiting'}</p>}
    {site.current ? <p>Latest deploy: {site.current.conclusion || site.current.status}{site.current.status !== 'completed' ? ` · ${elapsed(site.current.startedAt, checkedAt)}` : ''}</p> : null}
    {build?.error ? <p className="message error">{build.error}</p> : null}
    {build?.runUrl ? <p><a href={build.runUrl} target="_blank" rel="noreferrer">Open build run</a></p> : null}
    {site.health ? <p>Site: {site.health.site.ok ? 'Answering' : 'Needs attention'} · Admin: {site.health.admin.ok ? 'Answering' : 'Needs attention'} · Checked {formatDateTime(site.health.checkedAt)}</p> : <p>Site and admin have not been checked yet.</p>}
    <div className="actions">
      {site.canRetry ? <button type="button" className="button" disabled={disabled} onClick={() => onAction('retryBuild', { appId: site.id })}>Retry the build</button> : null}
      {site.canStop ? <button type="button" className="button" disabled={disabled} onClick={() => setConfirm('stop')}>Stop the build</button> : null}
      {site.canRedeploy ? <button type="button" className="button" disabled={disabled} onClick={() => setConfirm('redeploy')}>Redeploy site</button> : null}
    </div>
    {confirm ? <div className="confirm" role="group" aria-label={confirm === 'stop' ? 'Stop this build' : 'Redeploy this site'}>
      <p>{confirm === 'stop' ? `Stop the build for ${site.eventName} and the deploy runs it started? Resources already created stay in place.` : `Deploy the current main version to ${site.eventName}?`}</p>
      <button type="button" className="button primary" disabled={disabled} onClick={async () => {
        const body = confirm === 'stop' ? { appId: site.id, runId: build.runUrl.split('/').at(-1), confirm: true }
          : { appId: site.id, environment: site.environment, confirm: true };
        if (await onAction(confirm === 'stop' ? 'stopBuild' : 'redeploySite', body)) setConfirm('');
      }}>{disabled ? 'Working…' : 'Confirm'}</button>
      <button type="button" className="button quiet" disabled={disabled} onClick={() => setConfirm('')}>Keep as is</button>
    </div> : null}
    <details>
      <summary>Recent deploy runs</summary>
      <RunList runs={[...site.runs, ...history].filter((run, index, rows) => rows.findIndex((row) => row.id === run.id) === index)} />
      {error ? <p role="alert">{error}</p> : null}
      {page ? <button type="button" className="button" disabled={loading || disabled} onClick={older}>{loading ? 'Loading…' : 'Check earlier runs'}</button> : null}
    </details>
  </li>;
}

export default function Deployments() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [working, setWorking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const reading = useRef(false);
  const live = useRef(true);
  const load = useCallback(async () => {
    if (reading.current) return false;
    reading.current = true;
    setRefreshing(true);
    try {
      const result = await callApi('listDeployments', {});
      if (live.current) { setData(result); setError(null); }
      return true;
    } catch (err) {
      if (live.current) setError(err);
      return false;
    } finally { reading.current = false; if (live.current) setRefreshing(false); }
  }, []);
  useEffect(() => {
    live.current = true;
    load();
    // Serial timeout: requests cannot overlap and hidden tabs make no reads.
    let timer;
    const tick = async () => {
      if (document.visibilityState === 'visible' && !inFlight.current) await load();
      if (live.current) timer = setTimeout(tick, 60_000);
    };
    timer = setTimeout(tick, 60_000);
    return () => { live.current = false; clearTimeout(timer); };
  }, [load]);
  async function act(name, body) {
    if (inFlight.current) return false;
    inFlight.current = true;
    setWorking(true);
    setNotice('');
    try {
      const result = await callApi(name, body);
      if (result.started === false) throw new Error('The build did not start. Open the request to read its details.');
      setNotice(name === 'stopBuild' ? 'The build and its active deploy runs stopped.' : 'The run was requested. It may take a minute to appear.');
      await load();
      return true;
    } catch (err) { setError(err); return false; }
    finally { inFlight.current = false; setWorking(false); }
  }
  if (isNotOperator(error)) return <HostingOnly />;
  return <section aria-labelledby="deployments-title">
    <PageHeading id="deployments-title" tabIndex={-1}>Deployments</PageHeading>
    <p className="folio">Hosting team</p>
    <p>This page refreshes about once a minute while it is open. Site and admin checks run every 15 minutes.</p>
    {notice ? <p className="message success" role="status">{notice}</p> : null}
    {error ? <p className="message error" role="alert">{error.message} Refresh before using the run controls.</p> : null}
    <button type="button" className="button" disabled={working || refreshing} onClick={load}>{refreshing ? 'Refreshing…' : 'Refresh deployments'}</button>
    {!data && !error ? <LoadingState>Loading deployments.</LoadingState> : null}
    {data?.sites.length === 0 ? <p>No client sites have started building yet.</p> : null}
    {data ? <ul className="cards">{data.sites.map((site) => <Site key={site.id} site={site} checkedAt={data.checkedAt} nextPage={data.nextPage} disabled={working || refreshing || Boolean(error)} onAction={act} />)}</ul> : null}
    <p className="section"><Link to="/review">Review requests</Link></p>
  </section>;
}
