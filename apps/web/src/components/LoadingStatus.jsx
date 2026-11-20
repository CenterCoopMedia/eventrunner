import HeldFigure from './HeldFigure.jsx';
import './loadingState.css';

const WAITING_DETAILS = {
  slow: 'This is taking longer than usual. We’re still waiting for a response.',
  prolonged: 'We haven’t received a result after a minute. You can keep waiting.',
};

const RING = (
  <svg className="loading-status__activity" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="9" className="loading-status__track" />
    <path d="M12 3a9 9 0 0 1 9 9" />
  </svg>
);

/**
 * One stable live region; the decorative activity cue never announces. The
 * public site draws the held-up figure and the admin keeps its ring. `none`
 * is for a status beside a busy control, which draws the page's one figure.
 * `still` is for previews that show a stage without waiting.
 *
 * @param {{ label?: string, stage?: string, figure?: 'held' | 'ring' | 'none', still?: boolean }} props
 */
export default function LoadingStatus({ label = 'Loading…', stage = 'initial', figure = 'held', still = false }) {
  const detail = WAITING_DETAILS[stage];
  const waiting = stage !== 'initial';
  return (
    <div className="loading-status" data-loading-stage={stage}>
      {figure === 'ring' ? (
        <span className="loading-status__activity-slot" aria-hidden="true">{waiting ? RING : null}</span>
      ) : null}
      {figure === 'held' ? (
        <span className="loading-status__activity-slot loading-status__activity-slot--held" aria-hidden="true">
          {waiting ? <HeldFigure stage={stage} still={still} /> : null}
        </span>
      ) : null}
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
