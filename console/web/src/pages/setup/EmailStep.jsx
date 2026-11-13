import { TextField } from '../../setup/Field.jsx';
import { SITE_DOMAIN } from '../../setup/steps.js';

/** `Sender name <hello@name.eventrunner.org>`, as the inbox shows it. */
export function senderPreview(senderName, siteName) {
  return `${senderName || 'Your event'} <hello@${siteName || 'your-name'}.${SITE_DOMAIN}>`;
}

/** Step 6: the sender name and the address that gets replies. */
export default function EmailStep({ value, errors, onChange, answers }) {
  const set = (key) => (next) => onChange({ ...value, [key]: next });
  return (
    <div className="stack">
      <p className="lead">Choose the sender name and where replies go.</p>
      <TextField path="email.senderName" label="Sender name" hint="The name people see in their inbox. For example, your event name."
        value={value.senderName} onChange={set('senderName')} error={errors['email.senderName']} />
      <TextField path="email.replyTo" label="Reply address" hint="Replies to your site's email go to this address."
        type="email" inputMode="email" autoComplete="email"
        value={value.replyTo} onChange={set('replyTo')} error={errors['email.replyTo']} />
      <div className="preview" aria-label="Email preview">
        <p><span className="preview-label">From</span> <span className="preview-value">{senderPreview(value.senderName, answers.webAddress.name)}</span></p>
        <p><span className="preview-label">Replies go to</span> <span className="preview-value">{value.replyTo || 'your reply address'}</span></p>
      </div>
    </div>
  );
}
