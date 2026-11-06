import { TextField } from '../../setup/Field.jsx';

/** Step 1: the organization's name, website and mailing address. */
export default function OrganizationStep({ value, errors, onChange, onBlur }) {
  const set = (key) => (next) => onChange({ ...value, [key]: next }, `organization.${key}`);
  return (
    <div className="stack">
      <p className="lead">Add the organization that runs the event.</p>
      <TextField
        path="organization.name"
        label="Organization name"
        autoComplete="organization"
        value={value.name}
        onChange={set('name')}
        onBlur={() => onBlur('organization.name')}
        error={errors['organization.name']}
      />
      <TextField
        path="organization.website"
        label="Website (optional)"
        hint="For example, https://example.org"
        type="url"
        inputMode="url"
        autoComplete="url"
        value={value.website}
        onChange={set('website')}
        onBlur={() => onBlur('organization.website')}
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
        onBlur={() => onBlur('organization.address')}
        error={errors['organization.address']}
      />
    </div>
  );
}
