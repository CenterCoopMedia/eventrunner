// Standing "this is not a real event" notice for the static demo build.
//
// It renders only when VITE_DEMO_MODE=1 (lib/demoMode.js), so a client
// deployment never mounts it — the component compiles to a `false` branch
// and the bundler drops it. Deliberately quiet: one line above the header,
// theme tokens only (no hex, spec §7.6), and a role="note" landmark so it is
// announced once rather than interrupting.
//
// Reversed ink on the page's own ink role, so the bar inverts with the mode
// rather than pinning one color — bg-text-primary carries text-surface on
// it, closed by the hairline rule token. The measure and inline padding match
// the shell's own (Layout.jsx), so the line starts where the header does.
import { IS_DEMO } from '../lib/demoMode.js';

export default function DemoBanner() {
  if (!IS_DEMO) return null;

  return (
    <div
      role="note"
      aria-label="Demonstration site"
      className="no-print border-b-hairline border-b-rule-hairline bg-text-primary text-surface"
    >
      <p className="mx-auto max-w-5xl px-md py-xs text-caption text-pretty">
        <span className="font-semibold">Demo</span>
        <span aria-hidden="true"> — </span>
        <span className="sr-only">: </span>
        fictional event, read-only. Sign-in, bookmarks, and every other
        account feature are disabled here.
      </p>
    </div>
  );
}
