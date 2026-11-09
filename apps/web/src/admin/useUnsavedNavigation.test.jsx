import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Link } from 'react-router';
import { inAppPath, useUnsavedNavigation } from './useUnsavedNavigation.js';
import { UnsavedChangesDialog } from './components/UnsavedChanges.jsx';

function Editor({ unsaved, blocked = false, onSignOut = () => {} }) {
  const guard = useUnsavedNavigation(unsaved, { blocked });
  return (
    <>
      <h1>Editor</h1>
      <Link to="/other">Other page</Link>
      <button type="button" onClick={onSignOut} data-admin-action="sign-out" aria-label="Sign out"><svg aria-hidden="true" /></button>
      {guard.pending ? (
        <UnsavedChangesDialog
          onStay={guard.stay}
          onDiscard={guard.discard}
          canDiscard={guard.canDiscard}
        />
      ) : null}
    </>
  );
}

function renderEditor(unsaved, props = {}) {
  return render(
    <MemoryRouter initialEntries={['/edit']}>
      <Routes>
        <Route path="/edit" element={<Editor unsaved={unsaved} {...props} />} />
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

  it('contains focus and restores the attempted link when Escape keeps the draft', () => {
    renderEditor(true);
    const link = screen.getByRole('link', { name: 'Other page' });
    link.focus();
    fireEvent.click(link);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog).toHaveAttribute('open');
    const stay = screen.getByRole('button', { name: 'Stay' });
    expect(stay).toHaveFocus();
    fireEvent.keyDown(stay, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Discard changes' })).toHaveFocus();
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(link).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Editor' })).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(go).toHaveBeenLastCalledWith(-1);
    go.mockRestore();
  });

  it('guards again when the same editor has new changes after a discard', () => {
    // React Router keeps one editor instance across two records of one route
    // (Back from a duplicated invoice to its source). A discard must not turn
    // the guard off for the rest of that instance's life.
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    const tree = (unsaved) => (
      <MemoryRouter initialEntries={['/edit']}>
        <Routes>
          <Route path="/edit" element={<Editor unsaved={unsaved} />} />
          <Route path="/other" element={<h1>Other page</h1>} />
        </Routes>
      </MemoryRouter>
    );
    const view = render(tree(true));
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));

    view.rerender(tree(false)); // the other record loads clean
    view.rerender(tree(true)); // and is edited
    const reload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(reload);
    expect(reload.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole('link', { name: 'Other page' }));
    expect(screen.getByRole('alertdialog', { name: 'Unsaved changes' })).toBeInTheDocument();
    go.mockRestore();
  });

  it('undoes a forward history move by the index delta', () => {
    window.history.replaceState({ idx: 2 }, '');
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    renderEditor(true);
    window.history.replaceState({ idx: 4 }, '');
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(go).toHaveBeenCalledWith(-2);
    go.mockRestore();
  });

  it('keeps a second link from leaving while the dialog is open', () => {
    renderEditor(true);
    fireEvent.click(screen.getByRole('link', { name: 'Other page' }));
    fireEvent.click(screen.getByRole('link', { name: 'Other page' }));
    expect(screen.getByRole('alertdialog', { name: 'Unsaved changes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Editor' })).toBeInTheDocument();
  });

  it('asks before sign out and only signs out after discard', () => {
    const onSignOut = vi.fn();
    renderEditor(true, { onSignOut });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'Unsaved changes' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('hides discard while a save is running', () => {
    renderEditor(true, { blocked: true });
    fireEvent.click(screen.getByRole('link', { name: 'Other page' }));
    expect(screen.getByRole('button', { name: 'Stay' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Discard changes' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Editor' })).toBeInTheDocument();
  });
});
