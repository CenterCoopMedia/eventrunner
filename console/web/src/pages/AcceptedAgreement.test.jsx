import { screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { callApi } from '../api.js';
import { renderPage } from '../test/renderPage.jsx';
import AcceptedAgreement from './AcceptedAgreement.jsx';

vi.mock('../api.js', () => ({ callApi: vi.fn() }));

it('shows the accepted version', async () => {
  callApi.mockResolvedValue({
    agreement: { title: 'Hosting terms', version: 3, body: 'First.\n\nSecond.' },
    accepted: { version: 3, name: 'Ana Owner', email: 'ana@example.org', at: '2026-11-04T15:00:00.000Z' },
  });
  renderPage(<AcceptedAgreement />, {
    path: '/organizations/o1/applications/a1/agreement',
    route: '/organizations/:orgId/applications/:appId/agreement',
  });
  expect(await screen.findByRole('heading', { name: 'Hosting terms' })).toBeInTheDocument();
  expect(screen.getByText('Second.')).toBeInTheDocument();
  expect(callApi).toHaveBeenCalledWith('getAgreement', { orgId: 'o1', appId: 'a1' });
});
