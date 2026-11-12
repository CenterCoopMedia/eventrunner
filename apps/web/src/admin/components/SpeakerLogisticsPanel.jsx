// A speaker's answers from the Logistics step (ADR 0008 §3): travel, access
// needs, and audio and video needs. They live in speaker_logistics/{id},
// which only staff can read, and never reach the public speaker page. The
// speaker writes them; staff read them here.
import { useEffect, useState } from 'react';
import { readLogistics } from 'shared/speakerLogistics';
import { subscribeAdminDoc } from '../adminSource.js';
import { Notice, Panel } from './formControls.jsx';

const ROWS = Object.freeze([
  ['travel', 'Travel'],
  ['accessNeeds', 'Access needs'],
  ['avNeeds', 'Audio and video needs'],
]);

/** @param {{ speakerId: string, submittedAt: string|null, timeZone?: string }} props */
export default function SpeakerLogisticsPanel({ speakerId, submittedAt, timeZone }) {
  const [state, setState] = useState({ speakerId, logistics: undefined, error: null });
  useEffect(() => subscribeAdminDoc(
    `speaker_logistics/${speakerId}`,
    (data) => setState({ speakerId, logistics: readLogistics(data), error: null }),
    (error) => setState((previous) => ({ ...previous, error })),
  ), [speakerId]);
  // A row from another speaker's subscription is never shown for this one.
  const logistics = state.speakerId === speakerId ? state.logistics : undefined;
  const submitted = submittedAt
    ? new Date(submittedAt).toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone, timeZoneName: 'short',
    })
    : null;
  return (
    <Panel help="The speaker's own answers. Staff only: never published." title="Logistics" description="The speaker's own answers. Staff only: never published.">
      <p className="text-admin-sm text-admin-ink-secondary">
        {submitted ? `Profile submitted ${submitted}.` : 'The speaker has not submitted the profile steps yet.'}
      </p>
      {state.error ? <Notice tone="caution" message="Cannot load the logistics answers. Reconnecting." /> : null}
      {logistics === undefined ? null : (
        <dl className="mt-sm flex flex-col gap-xs">
          {ROWS.map(([key, label]) => (
            <div key={key}>
              <dt className="text-admin-sm font-semibold">{label}</dt>
              <dd className="whitespace-pre-line text-admin-sm text-admin-ink-secondary [overflow-wrap:anywhere]">{logistics[key] || 'No answer'}</dd>
            </div>
          ))}
        </dl>
      )}
    </Panel>
  );
}
