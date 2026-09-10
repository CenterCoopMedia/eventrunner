// ToastProvider — the bar that repeats a result the page already states.
//
// A TOAST IS A REPEAT, NOT A RECORD. The page states its result in place,
// beside the control that caused it, and that line stays. The toast says the
// same thing where the reader is looking and then goes. Nothing may exist
// only as a toast.
//
// THAT IS ALSO WHY A REPEAT IS SILENT. An in-place result already sits in a
// `role="status"` region, so a toast repeating it would announce the same
// sentence twice. A caller that states its result in place passes
// `announce: false`; a caller with no in-place line leaves the default, and
// the toast is the announcement. One result, announced once.
//
// THE TONE IS A RULE AND A WORD. Colour is never a status on its own
// (design brief §2.4), and the bar runs on reversed ink, where a tone colour
// would be a coloured edge — the pattern §2.4 rejects outright. So each tone
// states its own word at the head of the line and draws its own rule weight
// around the bar.
//
// The bar reads the tier 2 role names and the named scale (design brief
// §3.1, §3.7): bg-text-primary carries text-surface on it, the same
// reversed-ink idiom DemoBanner uses, so the toast follows the mode instead
// of pinning one tone. It floats over the page with no scrim behind it to
// tint against, so it takes the frame ModalShell uses for the same problem
// — a strong-rule border stands in for the elevation a shadow would have
// given it ("shadow decorates nothing", design brief §2.1).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const ToastContext = createContext(null);

let nextId = 0;

/**
 * How long a leaving toast stays in the document. It is `--motion-fast`, the
 * exit step, in milliseconds — the CSS runs the fade and this holds the
 * element until the fade is over. `toastMotion.test.js` pins the two
 * together, so the token cannot move without this moving with it.
 */
export const TOAST_EXIT_MS = 120;

/**
 * Each tone's word and rule. The word is the first signal and it is always
 * present; the rule weight is the second. Neither is a colour.
 */
const TONES = Object.freeze({
  info: { word: 'Note', frame: 'border-hairline' },
  error: { word: 'Problem', frame: 'border-strong' },
});

/**
 * Whether this page is the admin room.
 *
 * The provider sits above the router and above the admin, so it cannot be
 * told which surface it is on by a prop, and the room is a page-level fact
 * rather than a per-toast one. The room marks itself with `.admin-room`, and
 * that is what is read here: the admin has no enter and no exit, so the bar
 * carries no motion class there (design brief §2.2; expansion record §2.2).
 */
function inAdminRoom() {
  if (typeof document === 'undefined') return false;
  return document.querySelector('.admin-room') !== null;
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  // Every timer this provider started, so none of them fires into an
  // unmounted tree.
  const timers = useRef(new Set());

  const later = useCallback((run, delay) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      run();
    }, delay);
    timers.current.add(timer);
    return timer;
  }, []);

  useEffect(() => {
    const started = timers.current;
    return () => {
      for (const timer of started) clearTimeout(timer);
      started.clear();
    };
  }, []);

  const dismiss = useCallback(
    (id) => {
      // The bar is marked as leaving first, so the exit can run, and it is
      // removed when the exit is over. Under reduced motion nothing moves
      // and the wait is imperceptible.
      setToasts((current) =>
        current.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)),
      );
      later(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, TOAST_EXIT_MS);
    },
    [later],
  );

  const showToast = useCallback(
    (message, { tone = 'info', duration = 5000, announce = true } = {}) => {
      const id = nextId++;
      setToasts((current) => [...current, { id, message, tone, announce, leaving: false }]);
      if (duration > 0) later(() => dismiss(id), duration);
      return id;
    },
    [dismiss, later],
  );

  const value = useMemo(() => ({ showToast, dismiss }), [showToast, dismiss]);
  const motion = !inAdminRoom();

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-md z-50 flex flex-col items-center gap-xs px-md">
        {toasts.map((toast) => {
          const tone = TONES[toast.tone] ?? TONES.info;
          const move = motion ? (toast.leaving ? 'motion-exit' : 'motion-enter') : '';
          return (
            <div
              key={toast.id}
              role={toast.announce ? (toast.tone === 'error' ? 'alert' : 'status') : undefined}
              className={`pointer-events-auto flex items-baseline gap-sm rounded-brand ${tone.frame} border-surface bg-text-primary px-md py-sm text-surface ${move}`}
            >
              <span className="font-data text-folio font-semibold uppercase">
                {tone.word}
              </span>
              <span className="flex-1">{toast.message}</span>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss notification"
                className="touch-target -my-xs flex items-center justify-center rounded-brand px-xs text-surface"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          );
        })}
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
