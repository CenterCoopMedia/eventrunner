import { forwardRef, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import AdminIcon from './AdminIcon.jsx';
import './adminInteraction.css';

/** Names stay available to assistive technology and on hover or keyboard focus. */
const AdminIconControl = forwardRef(function AdminIconControl({
  as: Control = 'button', label, tooltip, icon, busy = false, className = '', onClick, onKeyDown, ...props
}, forwardedRef) {
  const controlRef = useRef(null);
  const tooltipRef = useRef(null);
  const tooltipId = useId();
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const closeTimer = useRef(null);
  const focused = useRef(false);
  const hovered = useRef(false);
  const keepOpen = () => {
    clearTimeout(closeTimer.current);
    setVisible(true);
  };
  const leave = () => {
    hovered.current = false;
    if (!tooltip) {
      if (!controlRef.current?.matches(':focus-visible')) setVisible(false);
      return;
    }
    if (focused.current) return;
    closeTimer.current = setTimeout(() => setVisible(false), 150);
  };
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  useLayoutEffect(() => {
    if (!visible || !controlRef.current || !tooltipRef.current) return;
    const place = () => {
      const anchor = controlRef.current.getBoundingClientRect();
      const hint = tooltipRef.current.getBoundingClientRect();
      const beside = anchor.right + 8 + hint.width <= window.innerWidth - 8;
      setPosition({
        left: Math.max(8, Math.min(beside ? anchor.right + 8 : anchor.left, window.innerWidth - hint.width - 8)),
        top: Math.max(8, Math.min(beside ? anchor.top + (anchor.height - hint.height) / 2 : anchor.bottom + 8, window.innerHeight - hint.height - 8)),
      });
    };
    const moved = () => { if (tooltip && focused.current) place(); else setVisible(false); };
    place();
    window.addEventListener('scroll', moved, true);
    window.addEventListener('resize', moved);
    return () => {
      window.removeEventListener('scroll', moved, true);
      window.removeEventListener('resize', moved);
    };
  }, [visible, label, tooltip]);

  useEffect(() => {
    if (!visible) return;
    const hide = () => setVisible(false);
    const dismiss = (event) => {
      if (event.key === 'Escape') {
        clearTimeout(closeTimer.current);
        setVisible(false);
      }
    };
    const outside = (event) => {
      if (!controlRef.current?.contains(event.target) && !tooltipRef.current?.contains(event.target)) hide();
    };
    document.addEventListener('keydown', dismiss);
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('keydown', dismiss);
      document.removeEventListener('pointerdown', outside);
    };
  }, [visible]);

  return (
    <>
      <Control
        {...(Control === 'button' ? { type: 'button' } : {})}
        {...props}
        ref={(node) => {
          controlRef.current = node;
          if (typeof forwardedRef === 'function') forwardedRef(node);
          else if (forwardedRef) forwardedRef.current = node;
        }}
        aria-label={label}
        aria-labelledby={visible && !tooltip ? tooltipId : undefined}
        className={`admin-icon-control ${className}`}
        onFocus={() => { focused.current = true; keepOpen(); }}
        onBlur={() => { focused.current = false; if (!tooltip || !hovered.current) setVisible(false); }}
        onPointerEnter={() => { hovered.current = true; keepOpen(); }}
        onPointerLeave={leave}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && visible) {
            setVisible(false);
            event.preventDefault();
            event.stopPropagation();
          }
          onKeyDown?.(event);
        }}
        onClick={(event) => { clearTimeout(closeTimer.current); setVisible(Boolean(tooltip)); onClick?.(event); }}
      >
        {busy ? <span className="admin-busy-mark" aria-hidden="true" /> : <AdminIcon name={icon} />}
      </Control>
      {visible ? createPortal(
        <span ref={tooltipRef} id={tooltipId} role="tooltip" aria-hidden={tooltip ? true : undefined} className={`admin-control-tooltip ${tooltip ? 'admin-help-tooltip' : ''}`} style={position} onPointerEnter={() => { hovered.current = true; keepOpen(); }} onPointerLeave={leave}>{tooltip ?? label}</span>,
        // A native modal's top layer must also contain its tooltip.
        controlRef.current?.closest('dialog[open]') ?? document.body,
      ) : null}
    </>
  );
});

export default AdminIconControl;
