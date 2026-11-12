import { useId } from 'react';
import AdminIconControl from './AdminIconControl.jsx';

/** Help stays available to screen readers even while its visual tooltip is closed. */
export default function HelpTooltip({ label, children, id: suppliedId, descriptionId }) {
  const generatedId = useId();
  const id = descriptionId ?? suppliedId ?? generatedId;
  if (!children) return null;
  return (
    <>
      <AdminIconControl
        icon="help"
        label={`Help with ${typeof label === 'string' ? label : 'this section'}`}
        tooltip={children}
        aria-describedby={id}
        onClick={(event) => event.preventDefault()}
        className="admin-help-trigger"
      />
      {descriptionId ? null : <span id={id} className="sr-only">{children}</span>}
    </>
  );
}
