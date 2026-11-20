import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { expect, it, vi } from 'vitest';
import AdminNavigationLinkEditor from './AdminNavigationLinkEditor.jsx';

const { call } = vi.hoisted(() => ({ call: vi.fn().mockResolvedValue({ status: 'dirty' }) }));
vi.mock('../adminApi.js', () => ({ useAdminApi: () => call }));
vi.mock('../../contexts/ToastContext.jsx', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../useAdminPages.js', () => ({ useAdminPages: () => ({
  ready: true, loading: false,
  rows: [{ id: 'travel', current: { id: 'travel', label: 'Travel', path: '/travel', order: 5, visible: true } }],
}) }));

it('chooses a site page and saves its navigation link through the Pages draft flow', async () => {
  render(<MemoryRouter initialEntries={['/admin/pages/links/new']}>
    <Routes>
      <Route path="/admin/pages/links/:linkId" element={<AdminNavigationLinkEditor />} />
      <Route path="/admin/pages" element={<h1>Pages</h1>} />
    </Routes>
  </MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Menu label'), { target: { value: 'Visitor information' } });
  fireEvent.change(screen.getByLabelText('Link destination'), { target: { value: 'external' } });
  fireEvent.change(screen.getByLabelText('HTTPS URL'), { target: { value: 'http://example.org/' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  expect(screen.getByText(/enter a valid https URL/i)).toBeInTheDocument();
  expect(call).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText('Link destination'), { target: { value: 'internal' } });
  fireEvent.change(screen.getByLabelText('Page'), { target: { value: '/travel' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(call).toHaveBeenCalledWith('cmsSavePage', {
    create: true,
    page: { id: 'visitor-information', label: 'Visitor information', url: '/travel', visible: true, systemPage: false, order: 6 },
  }));
  expect(await screen.findByRole('heading', { name: 'Pages' })).toBeInTheDocument();
});
