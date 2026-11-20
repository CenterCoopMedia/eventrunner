import HeldFigure from './HeldFigure.jsx';
import LoadingAnnouncement, { WAITING_DETAILS } from './LoadingAnnouncement.jsx';
import './loadingState.css';

const RING = (
  <svg className="loading-status__activity" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="9" className="loading-status__track" />
    <path d="M12 3a9 9 0 0 1 9 9" />
  </svg>
);

/**
 * The public site draws the held-up figure and the admin keeps its ring. `none`
 * is for a status beside a busy control, which draws the page's one figure.
 * `still` is for previews that show a stage without waiting.
 *
 * @param {{ label?: string, stage?: string, figure?: 'held' | 'ring' | 'none', still?: boolean, clock?: object, announce?: boolean, prolongedAnnouncement?: string }} props
 */
export default function LoadingStatus({
  label = 'Loading…', stage = 'initial', figure = 'held', still = false, clock, announce = true, prolongedAnnouncement,
}) {
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
      <p aria-hidden={still ? undefined : 'true'} className="loading-status__copy">
        <span className="loading-status__label">{label}</span>
        {detail ? <span className="loading-status__detail">{detail}</span> : null}
      </p>
      {announce && !still ? (
        <LoadingAnnouncement label={label} stage={stage} clock={clock} prolongedAnnouncement={prolongedAnnouncement} />
      ) : null}
    </div>
  );
}
