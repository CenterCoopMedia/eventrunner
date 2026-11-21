import useLoadingStage from '../lib/useLoadingStage.js';
import { usePublicLanguage } from '../contexts/PublicLanguageContext.jsx';
import { secondaryActionClass } from './controlClasses.js';
import LoadingStatus from './LoadingStatus.jsx';

const SHAPES = new Set(['rows', 'schedule', 'directory']);

/**
 * The same renderer powers real requests and the specimen’s explicit previews.
 * Still text and portrait shapes reserve space without inventing content.
 */
export function LoadingStateView({
  label,
  rows = 3,
  shape = 'rows',
  stage = 'initial',
  onRetry,
  recover,
  placeholder,
  figure,
  still,
  clock,
  announce,
  active = true,
  completion,
}) {
  const layout = SHAPES.has(shape) ? shape : 'rows';
  const rowCount = Number.isFinite(rows) ? Math.max(0, Math.floor(rows)) : 3;
  const { text } = usePublicLanguage();
  // The one-minute stage bounds the loading UI. Only an explicit retry
  // restarts the operation, so a response can still finish the current wait.
  const retryAvailable = active && stage === 'prolonged' && typeof onRetry === 'function';
  const stalled = recover && retryAvailable;
  const showPlaceholder = active && placeholder && !stalled;
  return (
    <>
      {showPlaceholder ? placeholder : null}
      <div
        className={active && !showPlaceholder ? 'loading-state py-xl' : 'sr-only'}
        data-loading-stage={active ? stage : undefined}
        data-loading-shape={active ? layout : undefined}
      >
        <LoadingStatus label={label} stage={stage} figure={figure} still={still} clock={clock} announce={announce} active={active} completion={completion}
          stalledMessage={stalled ? text('This is taking longer than a minute. Check your connection and try again.', 'Esto está tardando más de un minuto. Comprueba tu conexión e inténtalo de nuevo.') : undefined} />
        {retryAvailable ? (
          <div className={stalled ? 'mt-sm' : 'loading-state__actions mt-sm'}>
            <button type="button" className={secondaryActionClass} onClick={onRetry}>
              {stalled ? text('Try again', 'Inténtalo de nuevo') : 'Try loading again'}
            </button>
          </div>
        ) : null}
        {active && !stalled && !showPlaceholder && rowCount > 0 ? (
          <div
            aria-hidden="true"
            className="loading-state__placeholder mt-md"
            data-loading-shape={layout}
          >
            {Array.from({ length: rowCount }, (_, index) => (
              <div key={index} className="loading-state__row">
                <span className="loading-state__lead" />
                <span className="loading-state__content">
                  <span className="loading-state__details" />
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}

/** Retry is available only when a caller supplies an explicit, safe request. */
export default function LoadingState({ onRetry, routeAttempt, active = true, phase, completion, ...props }) {
  const { stage, clock, restart } = useLoadingStage({ active, routeAttempt, phase });
  const retry = typeof onRetry === 'function' ? () => {
    onRetry();
    restart();
  } : undefined;
  // Completion uses the same live region that was present before the read.
  // An empty completion lets the caller's existing alert announce a failure.
  return <LoadingStateView {...props} stage={stage} clock={clock} onRetry={retry} active={active} completion={completion} />;
}
