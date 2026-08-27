// ToastProvider — minimal working implementation; the M2 UI tranche may
// extend it (queueing, actions, exit animations behind the reduced-motion
// guard). Routine updates announce via role="status"; role="alert" is
// reserved for urgent errors only (interface guidelines).
//
// The bar reads the tier 2 role names and the named scale (design brief
// §3.1, §3.7): bg-text-primary carries text-surface on it, the same
// reversed-ink idiom DemoBanner uses, so the toast follows the mode instead
// of pinning one tone. It floats over the page with no scrim behind it to
// tint against, so it takes the frame ModalShell uses for the same problem
// — a strong-rule border stands in for the elevation a shadow would have
// given it ("shadow decorates nothing", design brief §2.1).
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ToastContext = createContext(null);

let nextId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message, { tone = 'info', duration = 5000 } = {}) => {
      const id = nextId++;
      setToasts((current) => [...current, { id, message, tone }]);
      if (duration > 0) {
        setTimeout(() => dismiss(id), duration);
      }
      return id;
    },
    [dismiss],
  );

  const value = useMemo(() => ({ showToast, dismiss }), [showToast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-md z-50 flex flex-col items-center gap-xs px-md"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto flex items-center gap-sm rounded-brand border-strong border-rule-strong bg-text-primary px-md py-sm text-surface"
          >
            <span>{toast.message}</span>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
              className="touch-target -my-xs flex items-center justify-center rounded-brand px-xs text-surface/80"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used inside <ToastProvider>.');
  }
  return ctx;
}

export default ToastContext;
