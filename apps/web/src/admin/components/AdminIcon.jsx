/** Familiar utility actions use the same 20px stroke and a full control target. */
export default function AdminIcon({ name, className = '' }) {
  const paths = {
    close: <path d="m6 6 12 12M18 6 6 18" />,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    collapse: <path d="m14 6-6 6 6 6" />,
    expand: <path d="m10 6 6 6-6 6" />,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.2 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4M12 17h.01" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18" /></>,
    signOut: <><path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M10 12h10m-4-4 4 4-4 4" /></>,
  };
  return (
    <svg aria-hidden="true" focusable="false" className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}
