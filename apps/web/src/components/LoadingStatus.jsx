import './loadingState.css';

const WAITING_DETAILS = {
  slow: 'This is taking longer than usual. We’re still waiting for a response.',
  prolonged: 'We haven’t received a result after a minute. You can keep waiting.',
};

/** One stable live region; the decorative activity cue never announces. */
export default function LoadingStatus({ label = 'Loading…', stage = 'initial' }) {
  const detail = WAITING_DETAILS[stage];
  return (
    <div className="loading-status" data-loading-stage={stage}>
      <span className="loading-status__activity-slot" aria-hidden="true">
        {stage !== 'initial' ? (
          <svg
            className="loading-status__activity"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            focusable="false"
          >
            <circle cx="12" cy="12" r="9" className="loading-status__track" />
            <path d="M12 3a9 9 0 0 1 9 9" />
          </svg>
        ) : null}
      </span>
      <p
        role="status"
        aria-label={label}
        aria-live="polite"
        aria-atomic="true"
        className="loading-status__copy"
      >
        <span className="loading-status__label">{label}</span>
        {detail ? <span className="loading-status__detail">{detail}</span> : null}
      </p>
    </div>
  );
}
