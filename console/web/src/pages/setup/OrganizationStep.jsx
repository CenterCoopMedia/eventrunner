import { TextField } from '../../setup/Field.jsx';

/** Step 1: the organization's name, website and mailing address. */
export default function OrganizationStep({ value, errors, onChange }) {
  const set = (key) => (next) => onChange({ ...value, [key]: next });
  return (
    <div className="stack">
      <p className="lead">Add the organization that runs the event.</p>
      <TextField
        path="organization.name"
        label="Organization name"
        autoComplete="organization"
        enterKeyHint="next"
        value={value.name}
        onChange={set('name')}
        error={errors['organization.name']}
      />
      <TextField
        path="organization.website"
        label="Website (optional)"
        hint="For example, https://example.org"
        type="url"
        inputMode="url"
        autoComplete="url"
        enterKeyHint="next" autoCapitalize="none" spellCheck={false}
        value={value.website}
        onChange={set('website')}
        error={errors['organization.website']}
      />
      <TextField
        path="organization.address"
        label="Mailing address"
        hint="This address appears at the bottom of your event emails."
        multiline
        autoComplete="street-address"
        value={value.address}
        onChange={set('address')}
        error={errors['organization.address']}
      />
    </div>
  );
}
