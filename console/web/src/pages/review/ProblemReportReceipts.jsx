import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import ScreenshotViewer from '@screenshot-ui/ScreenshotViewer.jsx';
import { callApi } from '../../api.js';

const PATH = '/review/problem-reports';
const LABELS = { bug: 'Something is broken', suggestion: 'An idea or a change', question: 'A question' };

export default function ProblemReportReceipts() {
  const [params] = useSearchParams();
  const id = params.get('id');
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    callApi('getProblemReportReceipts', id ? { id } : {}, { freshToken: true }).then(
      (data) => { if (current) setResult({ id, data }); },
      (error) => { if (current) setResult({ id, error: error.message }); },
    );
    return () => { current = false; };
  }, [id, attempt]);
  const data = result?.id === id ? result.data : null;
  const error = result?.id === id ? result.error : null;

  return (
    <section className="panel" aria-labelledby="reports-title">
      <p><Link to={id ? PATH : '/review'}>{id ? 'All problem reports' : 'Console review'}</Link></p>
      <h1 id="reports-title">{id ? 'Problem report' : 'Problem reports'}</h1>
      {!data && !error ? <p role="status">Loading reports…</p> : null}
      {error ? (
        <div>
          <p className="message error" role="alert">{error}</p>
          <button className="button" type="button" onClick={() => { setResult(null); setAttempt(attempt + 1); }}>Try again</button>
        </div>
      ) : null}
      {data?.receipt ? (
        <div>
          <p>{LABELS[data.receipt.category]} · {data.receipt.project}</p>
          {data.receipt.reporterEmail ? <p className="report-description">Reporter {data.receipt.reporterEmail}</p> : null}
          <p className="report-description">{data.receipt.description}</p>
          <p className="report-description">Page <a href={data.receipt.url}>{data.receipt.url}</a></p>
          {data.receipt.screenshotCount > 0 ? (
            <ScreenshotViewer
              key={id}
              count={data.receipt.screenshotCount}
              readScreenshot={(index) => callApi('readProblemReportScreenshot', { id, index }, { freshToken: true })}
              className="report-screenshots"
              buttonClass="button quiet"
            />
          ) : null}
        </div>
      ) : null}
      {data?.receipts?.length ? (
        <ul>
          {data.receipts.map((receipt) => (
            <li key={receipt.id}>
              <Link to={`${PATH}?id=${encodeURIComponent(receipt.id)}`}>
                {receipt.project} · {new Date(receipt.createdAt).toLocaleString()}
                {receipt.screenshotCount ? ` · ${receipt.screenshotCount} ${receipt.screenshotCount === 1 ? 'screenshot' : 'screenshots'}` : ''}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {data?.receipts?.length === 0 ? <p>There are no recent reports.</p> : null}
    </section>
  );
}
