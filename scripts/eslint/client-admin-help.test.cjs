'use strict';
const { RuleTester } = require('eslint');
const rule = require('./client-admin-help.cjs');

new RuleTester({ languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } }).run('client-admin-help', rule, {
  valid: [
    '<TextField label="Email" data-help-skip="The label names the email address." />',
    '<TextField label="Track" help="Choose the program topic for this session." />',
    '<SelectField label={label} help={field.help} />',
    '<input type="hidden" value="unchanged" />',
    'isOperator ? <TextField label="Price" /> : null',
    { code: 'canEditLifecycle ? <EventDateTimeField label="Announced" /> : null', filename: '/apps/web/src/admin/pages/AdminEventSettings.jsx' },
    'function ConnectionSettings() { return <TextField label="Base" />; }',
  ],
  invalid: [
    { code: '<TextField label="Track" />', errors: [{ messageId: 'missing' }] },
    { code: '<NewField label="New staff field" hint="Saving…" />', errors: [{ messageId: 'missing' }] },
    { code: '<TextField label="Track" help=" " />', errors: [{ messageId: 'missing' }] },
    { code: '<TextField label="Track" help={undefined} />', errors: [{ messageId: 'missing' }] },
    { code: '<input aria-label="Upload" />', errors: [{ messageId: 'missing' }] },
    ...['input', 'select', 'textarea', 'Checkbox', 'Radio'].map(name => ({
      code: `<${name} help="This component does not render help." />`, errors: [{ messageId: 'missing' }],
    })),
    { code: 'isOperator ? null : <TextField label="Staff field" />', errors: [{ messageId: 'missing' }] },
    { code: 'canEditLifecycle ? <TextField label="Staff field" /> : null', filename: '/apps/web/src/admin/pages/Other.jsx', errors: [{ messageId: 'missing' }] },
  ],
});
