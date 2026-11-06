import WaitingBuddy from './WaitingBuddy.jsx';

/** The page title keeps its focus target and a still, decorative Badger. */
export default function PageHeading({ children, className = '', ...props }) {
  return (
    <h1 {...props} className={`page-heading${className ? ` ${className}` : ''}`}>
      <span className="page-heading__mascot" aria-hidden="true"><WaitingBuddy /></span>
      <span className="page-heading__text">{children}</span>
    </h1>
  );
}
