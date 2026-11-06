import useLoadingStage from '../lib/useLoadingStage.js';
import { secondaryActionClass } from './controlClasses.js';
import LoadingStatus from './LoadingStatus.jsx';

const SHAPES = new Set(['rows', 'schedule', 'directory']);

/**
 * The same renderer powers real requests and the specimen’s explicit previews.
 * Still text and portrait shapes reserve space without inventing content.
 */
export function LoadingStateView({
  label = 'Loading…',
  rows = 3,
  shape = 'rows',
  stage = 'initial',
  onRetry,
}) {
  const layout = SHAPES.has(shape) ? shape : 'rows';
  const rowCount = Number.isFinite(rows) ? Math.max(0, Math.floor(rows)) : 3;
  return (
    <div
      className="loading-state py-xl"
      data-loading-stage={stage}
      data-loading-shape={layout}
    >
      <LoadingStatus label={label} stage={stage} />
      {stage === 'prolonged' && typeof onRetry === 'function' ? (
        <div className="loading-state__actions mt-sm">
          <button type="button" className={secondaryActionClass} onClick={onRetry}>
            Try loading again
          </button>
        </div>
      ) : null}
      {rowCount > 0 ? (
        <div
          aria-hidden="true"
          className="loading-state__placeholder mt-md"
          data-loading-shape={layout}
        >
          {Array.from({ length: rowCount }, (_, index) => (
            <div
              key={index}
              className="loading-state__row border-t-hairline border-rule-hairline"
            >
              {layout === 'schedule' ? (
                <span className="loading-state__time">
                  <span className="loading-state__bar loading-state__bar--time" />
                  <span className="loading-state__bar loading-state__bar--time-detail" />
                </span>
              ) : null}
              {layout === 'directory' ? <span className="loading-state__portrait" /> : null}
              <span className="loading-state__content">
                <span className="loading-state__bar loading-state__bar--title" />
                <span className="loading-state__bar loading-state__bar--detail" />
                {layout !== 'rows' ? (
                  <span className="loading-state__bar loading-state__bar--detail loading-state__bar--short" />
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Retry is available only when a caller supplies an explicit, safe request. */
export default function LoadingState({ onRetry, ...props }) {
  const { stage, restart } = useLoadingStage();
  const retry = typeof onRetry === 'function' ? () => {
    onRetry();
    restart();
  } : undefined;
  return <LoadingStateView {...props} stage={stage} onRetry={retry} />;
}
