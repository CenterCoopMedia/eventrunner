import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import AdminNavigationLinkEditor from './AdminNavigationLinkEditor.jsx';
import { DeletionUndoProvider, DeletedRecordResult } from '../deletionUndo.jsx';

const { call } = vi.hoisted(() => ({ call: vi.fn().mockResolvedValue({ status: 'dirty' }) }));
const MAP_LINK = { id: 'map', label: 'Map', url: '/travel', order: 4, visible: true };
let mapLink;
vi.mock('../adminApi.js', () => ({ useAdminApi: () => call }));
vi.mock('../../contexts/ToastContext.jsx', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../useAdminPages.js', () => ({ useAdminPages: () => ({
  ready: true, loading: false,
  rows: [
    { id: 'travel', current: { id: 'travel', label: 'Travel', path: '/travel', order: 5, visible: true } },
    { id: 'map', current: mapLink },
  ],
}) }));

beforeEach(() => {
  call.mockClear();
  mapLink = MAP_LINK;
});

function renderEditor(id) {
  const view = () => <MemoryRouter initialEntries={[`/admin/pages/links/${id}`]}>
    <DeletionUndoProvider>
      <Routes>
        <Route path="/admin/pages/links/:linkId" element={<AdminNavigationLinkEditor />} />
        <Route path="/admin/pages" element={<><h1>Pages</h1><DeletedRecordResult /></>} />
      </Routes>
    </DeletionUndoProvider>
  </MemoryRouter>;
  const { rerender } = render(view());
  return () => rerender(view());
}

it('chooses a site page and saves its navigation link through the Pages draft flow', async () => {
  renderEditor('new');
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
    expectedRevision: null,
    page: { id: 'visitor-information', label: 'Visitor information', url: '/travel', visible: true, systemPage: false, order: 6 },
  }));
  expect(await screen.findByRole('heading', { name: 'Pages' })).toBeInTheDocument();
});

it('saves a rename without resending the earlier destination or visibility', async () => {
  const refresh = renderEditor('map');
  fireEvent.change(screen.getByLabelText('Menu label'), { target: { value: 'Getting here' } });
  mapLink = { ...MAP_LINK, url: 'https://example.org/map', visible: false };
  refresh();

  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(call).toHaveBeenCalledWith('cmsSavePage', {
    navigationLink: { id: 'map', label: 'Getting here' },
  }));
  expect(await screen.findByRole('heading', { name: 'Pages' })).toBeInTheDocument();
});

it('removes a saved navigation link through the Pages recovery flow', async () => {
  renderEditor('map');
  fireEvent.click(screen.getByRole('button', { name: 'Delete this link' }));
  const confirm = await screen.findByRole('region', { name: 'Delete Map' });
  fireEvent.click(within(confirm).getByRole('button', { name: 'Delete this link' }));
  await waitFor(() => expect(call).toHaveBeenCalledWith('cmsDeletePage', { id: 'map' }));
  expect(await screen.findByText('Navigation link deleted.')).toBeVisible();
});
