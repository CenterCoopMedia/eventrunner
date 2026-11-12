import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { CommandMenuAccount, readCommandRecents, rememberCommandRecord } from '../commandMenuRecents.js';
import { useUnsavedNavigation } from '../useUnsavedNavigation.js';
import { UnsavedChangesDialog } from './UnsavedChanges.jsx';
import AdminPageHeader from './adminChrome.jsx';
import AdminCommandMenu, { commandShortcut } from './AdminCommandMenu.jsx';
import { docketForTier } from '../AdminLayout.jsx';

const docket = [{ label: 'Content', items: Array.from({ length: 15 }, (_, i) => ({ to: i === 0 ? 'pages' : `section-${i}`, label: i === 0 ? 'Pages' : `Section ${i}` })) }];

function Desk({ uid = 'menu-one', dirty = false }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const guard = useUnsavedNavigation(dirty);
  return (
    <CommandMenuAccount.Provider value={{ uid, pathname: location.pathname }}>
      <button type="button" onClick={() => setOpen(true)}>Find work</button>
      <input aria-label="Draft text" defaultValue="Keep this draft" />
      <output aria-label="Current route">{location.pathname}</output>
      {open ? <AdminCommandMenu docket={docket} onClose={() => setOpen(false)} /> : null}
      {guard.pending ? <UnsavedChangesDialog onStay={guard.stay} onDiscard={guard.discard} canDiscard={guard.canDiscard} /> : null}
    </CommandMenuAccount.Provider>
  );
}

const desk = (props = {}) => render(<MemoryRouter initialEntries={['/admin/pages/home']}><Desk {...props} /></MemoryRouter>);

function openMenu() {
  const opener = screen.getByRole('button', { name: 'Find work' });
  opener.focus();
  fireEvent.click(opener);
  return screen.getByRole('dialog', { name: 'Find work' });
}

describe('admin command menu', () => {
  it('offers only the existing staff docket to a staff account', () => {
    render(<MemoryRouter><AdminCommandMenu docket={docketForTier('staff')} onClose={() => {}} /></MemoryRouter>);
    expect(screen.getByRole('option', { name: 'Pages Content' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Event Settings' })).toBeInTheDocument();
    for (const label of ['Branding', 'Features', 'Access', 'System errors', 'Registration form', 'Web address']) {
      expect(screen.queryByRole('option', { name: new RegExp(`^${label} `) })).not.toBeInTheDocument();
    }
  });

  it('uses a focused native dialog, real anchor options and the existing combobox page keys', () => {
    desk();
    const dialog = openMenu();
    expect(dialog).toHaveAttribute('open');
    const input = within(dialog).getByRole('combobox', { name: 'Search sections and recent records' });
    expect(input).toHaveFocus();
    const options = within(dialog).getAllByRole('option');
    expect(options.every((option) => option.tagName === 'A' && option.tabIndex === -1)).toBe(true);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id);
    fireEvent.keyDown(input, { key: 'PageDown' });
    expect(input).toHaveAttribute('aria-activedescendant', options[10].id);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input).toHaveAttribute('aria-activedescendant', options[9].id);
    fireEvent.keyDown(input, { key: 'PageUp' });
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.queryByRole('dialog', { name: 'Find work' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Current route')).toHaveTextContent(/^\/admin\/pages$/);
  });

  it('searches sections and recent record titles, states no matches, and restores focus on Escape', () => {
    rememberCommandRecord('menu-search', { to: '/admin/pages/story', label: 'Community story' });
    desk({ uid: 'menu-search' });
    const dialog = openMenu();
    const input = within(dialog).getByRole('combobox');
    fireEvent.change(input, { target: { value: 'community' } });
    expect(within(dialog).getAllByRole('option')).toHaveLength(1);
    expect(within(dialog).getByRole('option', { name: 'Community story Recent record' })).toHaveAttribute('href', '/admin/pages/story');
    fireEvent.change(input, { target: { value: 'no such record' } });
    expect(within(dialog).getByRole('status')).toHaveTextContent('No matches.');
    expect(input).not.toHaveAttribute('aria-activedescendant');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Find work' })).toHaveFocus();
  });

  it.each(['mouse', 'keyboard'])('closes before the %s link reaches the dirty-form guard, keeps Stay usable, then Discard leaves', (method) => {
    desk({ dirty: true, uid: `menu-dirty-${method}` });
    const draft = screen.getByLabelText('Draft text');
    fireEvent.change(draft, { target: { value: 'An unsaved edit' } });
    const choose = () => {
      const dialog = openMenu();
      const input = within(dialog).getByRole('combobox');
      if (method === 'mouse') fireEvent.click(within(dialog).getByRole('option', { name: 'Pages Content' }));
      else { fireEvent.keyDown(input, { key: 'ArrowDown' }); fireEvent.keyDown(input, { key: 'Enter' }); }
      expect(dialog).not.toHaveAttribute('open');
      expect(screen.queryByRole('dialog', { name: 'Find work' })).not.toBeInTheDocument();
    };
    choose();
    const warning = screen.getByRole('alertdialog', { name: 'Unsaved changes' });
    fireEvent.click(within(warning).getByRole('button', { name: 'Stay' }));
    expect(draft).toHaveValue('An unsaved edit');
    expect(screen.getByLabelText('Current route')).toHaveTextContent(/^\/admin\/pages\/home$/);
    choose();
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByLabelText('Current route')).toHaveTextContent(/^\/admin\/pages$/);
  });

  it('records only a loaded publishable editor header, while standalone headers work without a router', () => {
    const view = render(<CommandMenuAccount.Provider value={{ uid: 'header-one', pathname: '/admin/pages/home' }}><AdminPageHeader title="Home page" /></CommandMenuAccount.Provider>);
    expect(readCommandRecents('header-one')).toEqual([{ to: '/admin/pages/home', label: 'Home page' }]);
    view.rerender(<CommandMenuAccount.Provider value={{ uid: 'header-one', pathname: '/admin/pages/home' }}><AdminPageHeader title="An unsaved title" /></CommandMenuAccount.Provider>);
    expect(readCommandRecents('header-one')).toEqual([{ to: '/admin/pages/home', label: 'Home page' }]);
    view.rerender(<CommandMenuAccount.Provider value={{ uid: 'header-one', pathname: '/admin/pages/home' }}><AdminPageHeader key="return-visit" title="Saved on a previous visit" /></CommandMenuAccount.Provider>);
    expect(readCommandRecents('header-one')).toEqual([{ to: '/admin/pages/home', label: 'Saved on a previous visit' }]);
    view.rerender(<CommandMenuAccount.Provider value={{ uid: 'header-two', pathname: '/admin/attendees/private' }}><AdminPageHeader title="Private attendee" /></CommandMenuAccount.Provider>);
    expect(readCommandRecents('header-two')).toEqual([]);
    view.rerender(<AdminPageHeader title="Standalone heading" />);
    expect(screen.getByRole('heading', { name: 'Standalone heading' })).toBeInTheDocument();
  });

  it('does not show another account’s recents when the account changes with the menu open', () => {
    rememberCommandRecord('menu-owner', { to: '/admin/pages/private-history', label: 'First account recent' });
    const view = desk({ uid: 'menu-owner' });
    openMenu();
    expect(screen.getByRole('option', { name: 'First account recent Recent record' })).toBeInTheDocument();
    view.rerender(<MemoryRouter><Desk uid="menu-other" /></MemoryRouter>);
    expect(screen.queryByRole('option', { name: 'First account recent Recent record' })).not.toBeInTheDocument();
  });
});

describe('command shortcut', () => {
  const event = (keys) => new KeyboardEvent('keydown', { key: 'k', ...keys });
  it('uses Command on Mac, preserves plain Control, and uses Control elsewhere', () => {
    expect(commandShortcut(event({ metaKey: true }), 'MacIntel')).toBe(true);
    expect(commandShortcut(event({ ctrlKey: true }), 'MacIntel')).toBe(false);
    expect(commandShortcut(event({ ctrlKey: true }), 'Win32')).toBe(true);
    expect(commandShortcut(event({ metaKey: true }), 'Linux x86_64')).toBe(false);
    expect(commandShortcut(event({ ctrlKey: true, shiftKey: true }), 'Win32')).toBe(false);
    expect(commandShortcut(event({ ctrlKey: true, altKey: true }), 'Win32')).toBe(false);
    expect(commandShortcut(event({}), 'MacIntel')).toBe(false);
  });
});
