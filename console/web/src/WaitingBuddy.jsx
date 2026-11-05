/**
 * A name badge on a lanyard, jogging in place: the console's company while a
 * long wait runs (loading the setup, a site build). Decorative only; the
 * status sentence beside it is the real message. It fades in after a short
 * wait, so a fast load never shows it, and holds still for reduced motion.
 */
export default function WaitingBuddy() {
  return (
    <svg className="wait-buddy" viewBox="0 0 64 72" aria-hidden="true" focusable="false">
      <ellipse className="wb-shadow" cx="32" cy="69" rx="13" ry="2.5" />
      <rect className="wb-confetti wb-c1" x="8" y="14" width="4" height="4" rx="1" />
      <rect className="wb-confetti wb-c2" x="52" y="10" width="4" height="4" rx="2" />
      <rect className="wb-confetti wb-c3" x="54" y="26" width="3" height="5" rx="1" />
      <path className="wb-line wb-leg-a" d="M27 50 L25 64 h-4" />
      <path className="wb-line wb-leg-b" d="M37 50 L39 64 h4" />
      <g className="wb-body">
        <path className="wb-strap" d="M16 -6 L30 13 M48 -6 L34 13" />
        <path className="wb-line wb-arm-a" d="M17 34 L9 42" />
        <path className="wb-line wb-arm-b" d="M47 34 L55 26" />
        <rect className="wb-badge" x="16" y="16" width="32" height="36" rx="5" />
        <path className="wb-band" d="M17.25 21a3.75 3.75 0 0 1 3.75-3.75h22a3.75 3.75 0 0 1 3.75 3.75v4.75h-29.5z" />
        <rect className="wb-ink" x="28" y="11" width="8" height="7" rx="1.5" />
        <g className="wb-eyes">
          <circle className="wb-ink" cx="26" cy="36" r="2.2" />
          <circle className="wb-ink" cx="38" cy="36" r="2.2" />
        </g>
        <path className="wb-line" d="M27 43 q5 4 10 0" />
      </g>
    </svg>
  );
}
