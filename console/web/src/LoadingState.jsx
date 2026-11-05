/** A decorative activity indicator beside the console's actual status. */
export default function LoadingState({ children, className = '' }) {
  return (
    <p role="status" aria-atomic="true" className={`console-loading ${className}`.trim()}>
      <span className="console-spinner" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
