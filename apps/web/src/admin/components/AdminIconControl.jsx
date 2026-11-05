import { forwardRef, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import AdminIcon from './AdminIcon.jsx';
import './adminInteraction.css';

/** Names stay available to assistive technology and on hover or keyboard focus. */
const AdminIconControl = forwardRef(function AdminIconControl({
  as: Control = 'button', label, icon, className = '', onClick, onKeyDown, ...props
}, forwardedRef) {
  const controlRef = useRef(null);
  const tooltipRef = useRef(null);
  const tooltipId = useId();
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!visible || !controlRef.current || !tooltipRef.current) return;
    const anchor = controlRef.current.getBoundingClientRect();
    const hint = tooltipRef.current.getBoundingClientRect();
    const beside = anchor.right + 8 + hint.width <= window.innerWidth - 8;
    setPosition({
      left: Math.max(8, Math.min(beside ? anchor.right + 8 : anchor.left, window.innerWidth - hint.width - 8)),
      top: Math.max(8, Math.min(beside ? anchor.top + (anchor.height - hint.height) / 2 : anchor.bottom + 8, window.innerHeight - hint.height - 8)),
    });
  }, [visible, label]);

  useEffect(() => {
    if (!visible) return;
    const hide = () => setVisible(false);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
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
        aria-labelledby={visible ? tooltipId : undefined}
        className={`admin-icon-control ${className}`}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        onPointerEnter={() => setVisible(true)}
        onPointerLeave={() => {
          if (!controlRef.current?.matches(':focus-visible')) setVisible(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && visible) {
            setVisible(false);
            event.preventDefault();
            event.stopPropagation();
          }
          onKeyDown?.(event);
        }}
        onClick={(event) => { setVisible(false); onClick?.(event); }}
      >
        <AdminIcon name={icon} />
      </Control>
      {visible ? createPortal(
        <span ref={tooltipRef} id={tooltipId} role="tooltip" className="admin-control-tooltip" style={position}>{label}</span>,
        // A native modal's top layer must also contain its tooltip.
        controlRef.current?.closest('dialog[open]') ?? document.body,
      ) : null}
    </>
  );
});

export default AdminIconControl;
