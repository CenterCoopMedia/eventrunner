// Synthetic records for the isolated Admin review document.
export const EXAMPLE_TIME = Date.UTC(2030, 4, 15, 14, 30);
export const EXAMPLE_SESSIONS = [
  { id: 'example-opening', title: 'Opening session' },
  { id: 'example-workshop', title: 'Reporting workshop' },
];
export const EXAMPLE_MATERIALS = [
  { id: 'example-data', sessionId: 'example-workshop', type: 'file', filename: 'Dataset.csv', reviewStatus: 'pending', updatedAt: EXAMPLE_TIME, managedStorageObject: true },
  { id: 'example-notes', sessionId: 'example-opening', type: 'file', filename: 'Opening notes.pdf', reviewStatus: 'approved', updatedAt: EXAMPLE_TIME - 60000, managedStorageObject: true },
  { id: 'example-link', sessionId: 'example-opening', type: 'link', filename: 'Workshop reading', url: 'https://example.test/reading', reviewStatus: 'rejected', updatedAt: EXAMPLE_TIME - 120000 },
];
export const EXAMPLE_ACCOUNTS = [
  { email: 'operator@example.test', tier: 'operator' },
  { email: 'support@example.test', tier: 'staff', support: true },
  { email: 'temporary@example.test', tier: 'staff', expiryState: 'active', expiresAt: '2030-06-01T17:00:00Z' },
  { email: 'ended@example.test', tier: 'staff', expiryState: 'expired', expiresAt: '2030-05-01T17:00:00Z' },
  { email: 'unreadable@example.test', tier: 'staff', expiryState: 'invalid', expiresAt: 'unreadable' },
];
export const EXAMPLE_INVOICES = [
  { id: 'example-draft', status: 'draft', currency: 'usd', billTo: { name: 'Example newsroom' }, totals: { total: 25000 } },
  { id: 'example-issued', number: 'EXAMPLE-0002', status: 'issued', currency: 'usd', billTo: { name: 'Example foundation' }, dueDate: '2030-06-01', totals: { total: 50000 }, needsReview: true },
  { id: 'example-paid', number: 'EXAMPLE-0001', status: 'paid', currency: 'usd', billTo: { name: 'Example association' }, dueDate: '2030-05-01', totals: { total: 12500 } },
];
export const EXAMPLE_MESSAGES = [
  { id: 'example-message', sentAt: EXAMPLE_TIME, to: 'reader@example.test', subject: 'Example event information', source: 'announcement', status: 'sent', deliveryStatus: 'delivered', bodyStored: true },
  { id: 'example-failed', sentAt: EXAMPLE_TIME - 60000, to: 'unavailable@example.test', subject: 'Example delivery failure', source: 'announcement', status: 'failed', bodyStored: true },
  { id: 'example-private', sentAt: EXAMPLE_TIME - 120000, to: 'account@example.test', subject: null, source: 'auth-otp', status: 'sent', bodyStored: false },
];
export const EXAMPLE_MESSAGE_BODY = {
  to: 'reader@example.test',
  html: '<table role="presentation" width="600"><tbody><tr><td><p>The example event opens at nine.</p><p><a href="https://example.test/info">Read the example information</a></p><img src="https://example.test/image.png" alt="Example image"></td></tr></tbody></table>',
  text: 'The example event opens at nine. Read the example information at https://example.test/info.',
};
export const EXAMPLE_RUNS = ['failed', 'running', 'done'].map((status, index) => ({
  id: `example-${status}`, status, requestedBy: 'editor@example.test', requestedAt: EXAMPLE_TIME - index * 60000,
  request: { cmsPages: ['example-one', 'example-two', 'example-three'] },
  progress: { cmsPages: { published: status === 'done' ? ['example-one', 'example-two', 'example-three'] : ['example-one'], skipped: [] } },
}));
export const EXAMPLE_VERSIONS = [
  { revision: 3, previousRevision: 2, publishedAt: EXAMPLE_TIME, publishedBy: 'editor@example.test', changes: [{ path: 'title', before: 'Workshop', after: 'Reporting workshop' }, { path: 'description', before: 'An introduction.', after: 'A practical reporting workshop. '.repeat(16) }] },
  { revision: 1, previousRevision: null, publishedAt: EXAMPLE_TIME - 86400000, publishedBy: null, changes: [{ path: 'title', before: null, after: 'Workshop' }] },
];
