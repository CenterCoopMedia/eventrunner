import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Link } from 'react-router-dom';
import { inAppPath, useUnsavedNavigation } from './useUnsavedNavigation.js';
import { UnsavedChangesDialog } from './components/UnsavedChanges.jsx';

function Editor({ unsaved }) {
  const guard = useUnsavedNavigation(unsaved);
  return (
    <>
      <h1>Editor</h1>
      <Link to="/other">Other page</Link>
      {guard.pending ? (
        <UnsavedChangesDialog onStay={guard.stay} onDiscard={guard.discard} />
      ) : null}
    </>
  );
}

function renderEditor(unsaved) {
  return render(
    <MemoryRouter initialEntries={['/edit']}>
      <Routes>
        <Route path="/edit" element={<Editor unsaved={unsaved} />} />
        <Route path="/other" element={<h1>Other page</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('inAppPath', () => {
  it('returns a same-origin path and ignores a new page or the current one', () => {
    expect(inAppPath('/admin/content', 'https://demo.example/admin/edit')).toBe('/admin/content');
    expect(inAppPath('https://demo.example/admin/edit', 'https://demo.example/admin/edit')).toBe(null);
    expect(inAppPath('https://elsewhere.example/admin', 'https://demo.example/admin/edit')).toBe(null);
    expect(inAppPath('https://demo.example/#/admin/section', 'https://demo.example/#/admin/edit')).toBe('/admin/section');
    expect(inAppPath('https://demo.example/#/admin/edit', 'https://demo.example/#/admin/edit')).toBe(null);
  });
});

describe('useUnsavedNavigation', () => {
  it('asks before an in-app link and stays or discards', () => {
    renderEditor(true);
    fireEvent.click(screen.getByRole('link', { name: 'Other page' }));
    expect(screen.getByRole('alertdialog', { name: 'Unsaved changes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Editor' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Editor' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Other page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByRole('heading', { name: 'Other page' })).toBeInTheDocument();
  });

  it('follows an in-app link while the form is clean', () => {
    renderEditor(false);
    fireEvent.click(screen.getByRole('link', { name: 'Other page' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Other page' })).toBeInTheDocument();
  });

  it('blocks reload while unsaved and lets a clean form reload', () => {
    const view = renderEditor(true);
    const blocked = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(blocked);
    expect(blocked.defaultPrevented).toBe(true);

    view.rerender(
      <MemoryRouter initialEntries={['/edit']}>
        <Routes>
          <Route path="/edit" element={<Editor unsaved={false} />} />
          <Route path="/other" element={<h1>Other page</h1>} />
        </Routes>
      </MemoryRouter>,
    );
    const allowed = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(allowed);
    expect(allowed.defaultPrevented).toBe(false);
  });

  it('stops browser Back and offers the same choice', () => {
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    renderEditor(true);
    const event = new PopStateEvent('popstate');
    const stop = vi.spyOn(event, 'stopImmediatePropagation');
    act(() => {
      window.dispatchEvent(event);
    });
    expect(stop).toHaveBeenCalled();
    expect(go).toHaveBeenCalledWith(1);
    expect(screen.getByRole('alertdialog', { name: 'Unsaved changes' })).toBeInTheDocument();

    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(back).toHaveBeenCalled();
    go.mockRestore();
    back.mockRestore();
  });
});
