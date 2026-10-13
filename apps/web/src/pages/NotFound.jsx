// Public recovery stays inside the event's existing theme and navigation gates.
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePages } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { buildNavItems, SYSTEM_PAGES } from '../lib/siteNavigation.js';
import { primaryActionClass } from '../components/controlClasses.js';
import './NotFound.css';

export default function NotFound() {
  const { pages } = usePages();
  const { eventConfig, features } = useEventConfig();
  const nav = buildNavItems(pages, features);
  const destinations = [SYSTEM_PAGES.schedule.to, SYSTEM_PAGES.speakers.to]
    .map((to) => nav.find((item) => item.to === to))
    .filter(Boolean);
  const [swing, setSwing] = useState(0);
  const [angle, setAngle] = useState(0);
  const drag = useRef(null);
  const moved = useRef(false);
  const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  const release = (event) => {
    if (!drag.current || drag.current.id !== event.pointerId) return;
    drag.current = null;
    setAngle(0);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (moved.current) setSwing((value) => value + 1);
  };

  return (
    <section className="not-found" aria-labelledby="not-found-title">
      <div className="not-found__intro">
        <h1 id="not-found-title">This page missed its cue.</h1>
        <p className="not-found__code">404 / Page not found</p>
        <p className="not-found__description">
          The address may be mistyped, or the page may have moved.
          Your next stop is still here.
        </p>
        <Link to="/" className={primaryActionClass}>Go to the home page</Link>
      </div>

      <div className="not-found__scene">
        <button
          type="button"
          className="not-found__ticket-control"
          aria-label="Swing the decorative ticket"
          onPointerDown={(event) => {
            if (reducedMotion() || event.button !== 0 || !event.isPrimary) return;
            moved.current = false;
            drag.current = { id: event.pointerId, x: event.clientX };
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!drag.current || drag.current.id !== event.pointerId) return;
            const delta = event.clientX - drag.current.x;
            if (Math.abs(delta) > 4) moved.current = true;
            setAngle(reducedMotion() ? 0 : Math.max(-14, Math.min(14, delta / 10)));
          }}
          onPointerUp={release}
          onPointerCancel={release}
          onLostPointerCapture={release}
          onClick={(event) => {
            // Pointer release already starts a swing after a drag. A keyboard
            // activation (detail=0) always gets the same replay path as a click.
            if (event.detail === 0 || !moved.current) setSwing((value) => value + 1);
            moved.current = false;
          }}
        >
          <span key={swing} className="not-found__hanging" data-dragging={angle !== 0}
            style={{ '--ticket-angle': `${angle}deg` }} aria-hidden="true">
            <span className="not-found__cord" />
            <span className="not-found__ticket bg-surface text-text-primary">
              <span className="not-found__eyelet" />
              <span className="not-found__event">{eventConfig.name}</span>
              <span className="not-found__number">404</span>
              <span className="not-found__ticket-caption">Page not found</span>
              <span className="not-found__stub">
                <span className="not-found__barcode" />
                <span>Not an admission ticket</span>
              </span>
            </span>
          </span>
        </button>
        <p className="not-found__hint">Drag the ticket, or select it to give it a swing.</p>
      </div>

      {destinations.length > 0 && (
        <nav className="not-found__destinations" aria-label="Find your next stop">
          <h2>Find your next stop</h2>
          <div className="not-found__links">
            {destinations.map((item, index) => (
              <Link key={item.to} to={item.to} className="not-found__destination">
                <span className="not-found__index" aria-hidden="true">0{index + 1}</span>
                <span><strong>{item.label}</strong><span className="not-found__link-detail">
                  {item.to === SYSTEM_PAGES.schedule.to
                    ? 'Browse sessions, times and the event program.'
                    : 'Meet the people taking the stage.'}
                </span></span>
                <span aria-hidden="true">↗</span>
              </Link>
            ))}
          </div>
        </nav>
      )}
    </section>
  );
}
