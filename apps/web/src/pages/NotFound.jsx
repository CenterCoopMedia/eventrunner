// Public recovery stays inside the event's existing theme and navigation gates.
import { useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { buildNavItems, SYSTEM_PAGES } from '../lib/siteNavigation.js';
import { primaryActionClass } from '../components/controlClasses.js';
import './NotFound.css';

const MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const getReducedMotion = () => window.matchMedia?.(MOTION_QUERY)?.matches === true;
const getServerReducedMotion = () => true;
function subscribeMotion(onChange) {
  const query = window.matchMedia?.(MOTION_QUERY);
  if (typeof query?.addEventListener === 'function') {
    query.addEventListener('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }
  // Match the legacy MediaQueryList support used by viewport.js.
  query?.addListener?.(onChange);
  return () => query?.removeListener?.(onChange);
}

function TicketArtwork({ name, angle = 0, dragging = false }) {
  return (
    <span className="not-found__hanging" data-dragging={dragging}
      style={{ '--ticket-angle': `${angle}deg` }} aria-hidden="true">
      <span className="not-found__cord" />
      <span className="not-found__ticket bg-surface text-text-primary">
        <span className="not-found__eyelet" />
        <span className="not-found__event">{name}</span>
        <span className="not-found__number">404</span>
        <span className="not-found__ticket-caption">Page not found</span>
        <span className="not-found__stub">
          <span className="not-found__barcode" />
          <span>Not an admission ticket</span>
        </span>
      </span>
    </span>
  );
}

function SwingingTicket({ name }) {
  const [swing, setSwing] = useState(0);
  const [angle, setAngle] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);
  const moved = useRef(false);
  const release = (event, replay) => {
    if (!drag.current || drag.current.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    setAngle(0);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (replay && moved.current && !getReducedMotion()) setSwing((value) => value + 1);
    if (!replay) moved.current = false;
  };

  return (
    <button
      type="button"
      className="not-found__ticket-control"
      aria-label="Swing the decorative ticket"
      onPointerDown={(event) => {
        if (getReducedMotion() || drag.current || event.button !== 0 || !event.isPrimary) return;
        moved.current = false;
        drag.current = { id: event.pointerId, x: event.clientX };
        setDragging(true);
        setAngle(0);
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current || drag.current.id !== event.pointerId || getReducedMotion()) return;
        const delta = event.clientX - drag.current.x;
        if (Math.abs(delta) > 4) moved.current = true;
        setAngle(Math.max(-14, Math.min(14, delta / 10)));
      }}
      onPointerUp={(event) => release(event, true)}
      onPointerCancel={(event) => release(event, false)}
      onLostPointerCapture={(event) => release(event, false)}
      onClick={(event) => {
        // Pointer release already starts a swing after a drag. Keyboard
        // activation always has its own replay path without replacing focus.
        if (!getReducedMotion() && !drag.current && (event.detail === 0 || !moved.current)) {
          setSwing((value) => value + 1);
        }
        moved.current = false;
      }}
    >
      <TicketArtwork key={swing} name={name} angle={angle} dragging={dragging} />
    </button>
  );
}

export default function NotFound() {
  const { pages } = useContent();
  const { eventConfig, features } = useEventConfig();
  const reducedMotion = useSyncExternalStore(subscribeMotion, getReducedMotion, getServerReducedMotion);
  const nav = buildNavItems(pages, features);
  const destinations = [SYSTEM_PAGES.schedule.to, SYSTEM_PAGES.speakers.to]
    .map((to) => nav.find((item) => item.to === to))
    .filter(Boolean);

  return (
    <section className="not-found" aria-labelledby="not-found-title">
      <div className="not-found__intro">
        <h1 id="not-found-title">Page not found</h1>
        <p className="not-found__code">404 / This page missed its cue.</p>
        <p className="not-found__description">
          The address may be mistyped, or the page may have moved.
          Your next stop is still here.
        </p>
        <Link to="/" className={primaryActionClass}>Go to the home page</Link>
      </div>

      <div className="not-found__scene">
        {reducedMotion ? (
          <div className="not-found__ticket-control" data-static="true" aria-hidden="true">
            <TicketArtwork name={eventConfig.name} />
          </div>
        ) : <SwingingTicket name={eventConfig.name} />}
        {!reducedMotion && <p className="not-found__hint">Drag the ticket, or select it to give it a swing.</p>}
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
