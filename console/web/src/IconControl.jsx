import { forwardRef } from 'react';
import { Link } from 'react-router';

const PATHS = {
  refresh: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1',
  edit: 'm15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z',
  delete: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  remove: 'M5 12h14',
  copy: 'M8 8h12v13H8zM16 8V3H3v13h5',
  close: 'm6 6 12 12M6 18 18 6',
  disconnect: 'm8 8 8 8M3 3l18 18M9 5l2-2a4.2 4.2 0 0 1 6 6l-2 2M9 13l-2 2a4.2 4.2 0 0 0 6 6l2-2',
};

/** A utility action with the same name for its icon and tooltip. */
const IconControl = forwardRef(function IconControl({ icon, label, to, href, className = '', ...props }, ref) {
  const Control = to ? Link : href ? 'a' : 'button';
  return (
    <span className="icon-control-wrap">
      <Control {...props} ref={ref} to={to} href={href} type={!to && !href ? 'button' : undefined}
        className={`button icon-control ${className}`.trim()} aria-label={label} title={label}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d={PATHS[icon]} />
        </svg>
      </Control>
      <span className="icon-control-tooltip" aria-hidden="true">{label}</span>
    </span>
  );
});

export default IconControl;
