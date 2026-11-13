import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { onAuthStateChanged, signInWithCustomToken, signOut } from 'firebase/auth';
import { getDocs } from 'firebase/firestore';
import { auth } from '../firebase.js';
import { AuthProvider } from '../contexts/AuthContext.jsx';
import AdminPageEditor from '../admin/pages/AdminPageEditor.jsx';
import { pageSnapshot, toEditablePage } from '../admin/pageDoc.js';
import { openLocalDraft } from '../lib/localDraft.js';
import Login from './Login.jsx';

vi.mock('../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ theme: {}, eventConfig: { historicalDemo: false } }),
}));
vi.mock('../contexts/ToastContext.jsx', () => ({ useToast: () => ({ showToast: () => {} }) }));
vi.mock('../admin/deletionUndo.jsx', () => ({ useDeletedRecord: () => vi.fn() }));
vi.mock('../admin/useAdminContent.js', () => ({ useAdminContent: () => ({ rows: [], ready: true }) }));
vi.mock('../admin/useAdminPages.js', () => ({
  useAdminPages: () => {
    const row = { id: 'faq', draft: PAGE, current: PAGE, state: 'draft' };
    return { rows: [row], ready: true, findRow: () => row };
  },
}));

const PAGE = { id: 'faq', label: 'FAQ', path: '/faq', updatedAt: 'today', basedOnRevision: 1,
  sections: [{ id: 'intro', label: 'Intro', description: 'Saved text' }] };
const ACCOUNT = { uid: 'alice', email: 'alice@example.test' };
const version = JSON.stringify([PAGE.updatedAt, PAGE.basedOnRevision]);
const read = () => openLocalDraft('alice', 'cmsPages/faq', version).read();
let authListener;

function renderAt(path = '/admin/pages/faq') {
  return render(<AuthProvider><MemoryRouter initialEntries={[{ pathname: path, state: { from: '/admin/pages/faq' } }]}>
    <Routes>
      <Route path="/admin/pages/:pageId" element={<AdminPageEditor mode="edit" />} />
      <Route path="/signin" element={<Login />} />
    </Routes>
  </MemoryRouter></AuthProvider>);
}
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.stubEnv('VITE_FUNCTIONS_ORIGIN', 'https://functions.example.test');
  auth.currentUser = { ...ACCOUNT, getIdToken: vi.fn().mockRejectedValue(new Error('expired')) };
  vi.mocked(onAuthStateChanged).mockImplementation((_auth, next) => {
    authListener = next; next(auth.currentUser); return () => {};
  });
  vi.mocked(getDocs).mockResolvedValue({ docs: [], metadata: { fromCache: false } });
  vi.mocked(signOut).mockImplementation(async () => { auth.currentUser = null; authListener(null); });
  vi.mocked(signInWithCustomToken).mockImplementation(async () => {
    // Firebase suppresses onAuthStateChanged for a same-UID refresh.
    auth.currentUser = { ...ACCOUNT, getIdToken: async () => 'fresh-synthetic-token' };
    return { user: auth.currentUser };
  });
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ challengeId: 'challenge', expiresInMinutes: 10 }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'synthetic-custom-token' }) }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); delete auth.currentUser; });

describe('page-edit recovery through the actual sign-in flow', () => {
  it('refreshes the same account with an emailed code and returns with the exact unsaved text kept', async () => {
    renderAt();
    fireEvent.change(screen.getByDisplayValue('Saved text'), { target: { value: '<p>Unsaved\ntext 🦊</p>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft', exact: true }));
    expect(await screen.findByText(/Your text is kept on this browser/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue as alice@example.test' }));
    expect(screen.getByLabelText('Email address')).toHaveValue(ACCOUNT.email);
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
    fireEvent.change(await screen.findByLabelText('Six-digit code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restore', exact: true }));
    expect(screen.getByDisplayValue('<p>Unsaved\ntext 🦊</p>')).toBeEnabled();
    expect(signInWithCustomToken).toHaveBeenCalledTimes(1);
    expect(signOut).not.toHaveBeenCalled();
    expect(JSON.parse(read().value).sections[0].description).toBe('<p>Unsaved\ntext 🦊</p>');
  });

  it('keeps explicit Sign out separate and clears the account’s local draft', async () => {
    const copy = openLocalDraft('alice', 'cmsPages/faq', version);
    copy.write('private text', pageSnapshot(toEditablePage(PAGE)));
    renderAt('/signin');
    expect(screen.getByRole('button', { name: 'Continue as alice@example.test' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(read()).toBeNull();
    expect(copy.write('late cleanup', 'saved')).toBe(false);
    expect(screen.getByLabelText('Email address')).toBeVisible();
  });
});
