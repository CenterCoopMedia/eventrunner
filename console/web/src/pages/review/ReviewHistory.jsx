import { STATUS_LABELS, formatDateTime } from '../../reviewText.js';

/** Who acted: a team member's email, or the hosting team for anyone else. */
function actor(entry) {
  if (entry.byEmail) return entry.byEmail;
  return entry.by ? 'the hosting team' : '';
}

/** The status changes, oldest first. */
export default function ReviewHistory({ history }) {
  if (!history.length) return <p>No status change yet.</p>;
  return (
    <ol className="history" aria-labelledby="history-title">
      {history.map((entry, i) => (
        <li key={`${entry.at}-${i}`}>
          <strong>{STATUS_LABELS[entry.status] || 'Updated'}</strong>
          <span className="muted"> {formatDateTime(entry.at)}{actor(entry) ? `, by ${actor(entry)}` : ''}</span>
          {entry.note ? <p className="history-note">{entry.note}</p> : null}
        </li>
      ))}
    </ol>
  );
}
