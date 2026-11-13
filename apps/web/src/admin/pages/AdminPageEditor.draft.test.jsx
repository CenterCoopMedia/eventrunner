import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import AdminPageEditor from './AdminPageEditor.jsx';
import { openLocalDraft } from '../../lib/localDraft.js';
import { pageSnapshot, toEditablePage } from '../pageDoc.js';

const state = vi.hoisted(() => ({ uid: 'alice', source: null, demo: false, call: vi.fn() }));
vi.mock('../../contexts/AuthContext.jsx', () => ({ useAuth: () => ({ user: { uid: state.uid } }) }));
vi.mock('../../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ theme: {}, eventConfig: { historicalDemo: state.demo } }),
}));
vi.mock('../adminApi.js', () => ({ useAdminApi: () => state.call }));
vi.mock('../deletionUndo.jsx', () => ({ useDeletedRecord: () => vi.fn() }));
vi.mock('../useAdminPages.js', () => ({
  useAdminPages: () => {
    const row = { id: 'faq', draft: state.source, current: state.source, state: 'draft' };
    return { rows: [row], ready: true, findRow: (id) => id === 'faq' ? row : null };
  },
}));
vi.mock('../useAdminContent.js', () => ({ useAdminContent: () => ({ rows: [], ready: true }) }));

const PAGE = {
  id: 'faq', label: 'FAQ', path: '/faq', basedOnRevision: 1, updatedAt: '2026-11-12',
  sections: [{ id: 'intro', label: 'Intro', description: 'Saved description', defaultBlocks: [] }],
};
const version = JSON.stringify([PAGE.updatedAt, PAGE.basedOnRevision]);
const read = () => openLocalDraft('alice', 'cmsPages/faq', version).read();
function renderEditor(path = '/admin/pages/faq') {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/admin/pages/:pageId" element={<AdminPageEditor mode={path.endsWith('/new') ? 'create' : 'edit'} />} />
    <Route path="/signin" element={<p>Sign-in destination</p>} />
  </Routes></MemoryRouter>);
}
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  state.uid = 'alice'; state.source = PAGE; state.demo = false;
  state.call.mockReset().mockResolvedValue({ id: 'faq' });
});
afterEach(() => vi.useRealTimers());

describe('page editor recovery', () => {
  it('clears the new-page copy when a save assigns its document id', async () => {
    const view = renderEditor('/admin/pages/new');
    fireEvent.change(screen.getByLabelText('Navigation label'), { target: { value: 'New page' } });
    fireEvent.change(screen.getByLabelText('Path'), { target: { value: '/new-page' } });
    act(() => vi.advanceTimersByTime(500));
    expect(openLocalDraft('alice', 'cmsPages/new', 'new').read()).not.toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save draft', exact: true })));
    view.unmount();
    expect(openLocalDraft('alice', 'cmsPages/new', 'new').read()).toBeNull();
  });

  it('offers the exact long text after unmount and clears it after a successful save', async () => {
    const first = renderEditor();
    const description = screen.getByDisplayValue('Saved description');
    fireEvent.change(description, { target: { value: '<p>Unsaved\n“text” 🦊</p>' } });
    act(() => vi.advanceTimersByTime(500));
    first.unmount();
    const reopened = renderEditor();
    expect(screen.getByRole('button', { name: 'Restore', exact: true })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Saved description')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
    expect(state.call).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Restore', exact: true }));
    expect(screen.getByDisplayValue('<p>Unsaved\n“text” 🦊</p>')).toBeEnabled();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save draft', exact: true })));
    expect(state.call.mock.calls[0][1].page.sections[0].description).toBe('<p>Unsaved\n“text” 🦊</p>');
    expect(read()).toBeNull();
    reopened.unmount();
    expect(read()).toBeNull();
  });

  it('states a stale version before restore, while Discard keeps the saved page', () => {
    const older = toEditablePage(PAGE);
    older.sections[0].description = 'Older local text';
    openLocalDraft('alice', 'cmsPages/faq', 'older-version').write(pageSnapshot(older));
    renderEditor();
    expect(screen.getByText(/This page changed since this copy was kept/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Older local text')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Discard local copy' }));
    expect(screen.getByDisplayValue('Saved description')).toBeEnabled();
    expect(read()).toBeNull();
    expect(state.call).not.toHaveBeenCalled();
  });

  it('never offers the first account’s copy to a different account', () => {
    const first = renderEditor();
    fireEvent.change(screen.getByDisplayValue('Saved description'), { target: { value: 'Alice private text' } });
    first.unmount();
    state.uid = 'bob';
    renderEditor();
    expect(screen.queryByRole('button', { name: 'Restore', exact: true })).toBeNull();
    expect(screen.getByDisplayValue('Saved description')).toBeEnabled();
    expect(read()).not.toBeNull();
  });

  it('keeps text before reauthentication and reaches sign-in without the discard dialog', async () => {
    state.call.mockRejectedValueOnce({ code: 'unauthenticated', message: 'Sign in again.' });
    renderEditor();
    fireEvent.change(screen.getByDisplayValue('Saved description'), { target: { value: 'Text before expiry' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save draft', exact: true })));
    expect(screen.getByText(/Your text is kept on this browser/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(screen.getByText('Sign-in destination')).toBeInTheDocument();
    expect(read()).not.toBeNull();
    expect(JSON.parse(read().value).sections[0].description).toBe('Text before expiry');
  });

  it('keeps the editor usable when storage throws and never stores demo text', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const first = renderEditor();
    fireEvent.change(screen.getByDisplayValue('Saved description'), { target: { value: 'Still editable' } });
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByDisplayValue('Still editable')).toBeEnabled();
    first.unmount();
    set.mockRestore();
    state.demo = true;
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    const demo = renderEditor();
    fireEvent.change(screen.getByDisplayValue('Saved description'), { target: { value: 'Demo text' } });
    act(() => vi.advanceTimersByTime(1000));
    demo.unmount();
    expect(writes).not.toHaveBeenCalled();
    writes.mockRestore();
  });
});
