import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Link, useLocation } from 'react-router';
import AuthContext from '../contexts/AuthContext.jsx';
import ProfileContext from '../contexts/ProfileContext.jsx';
import useAccountViews from '../hooks/useAccountViews.js';
import AccountMenu from './AccountMenu.jsx';
import AdminEntryLink from './AdminEntryLink.jsx';
import RoleSwitcher from './RoleSwitcher.jsx';
import { saveSessionView } from '../lib/accountViews.js';
import { useUnsavedNavigation } from '../admin/useUnsavedNavigation.js';
import { UnsavedChangesDialog } from '../admin/components/UnsavedChanges.jsx';

const demo = vi.hoisted(() => ({ static: false, event: {} }));
vi.mock('../lib/demoMode.js', () => ({ get IS_DEMO() { return demo.static; } }));
vi.mock('../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ eventConfig: demo.event }),
}));

const user = {uid:'fixture-340', getIdToken: async () => 'fixture-token'};
function Account({ compact = false, onNavigate }) {
  const account = useAccountViews();
  const {pathname} = useLocation();
  return <><p>{pathname}</p><Link to={account.current?.to ?? '/signin'}>Dashboard</Link>
    {compact ? <RoleSwitcher account={account} presentation="select" onNavigate={onNavigate} />
      : account.views.length > 1 ? <AccountMenu account={account}/> : null}<AdminEntryLink account={account}/><Link to="/schedule">Schedule</Link></>;
}
function GuardedAccount({ blocked, onNavigate }) {
  const guard = useUnsavedNavigation(true, {blocked});
  return <><Account compact onNavigate={onNavigate}/>{guard.pending ? <UnsavedChangesDialog
    onStay={guard.stay} onDiscard={guard.discard} canDiscard={guard.canDiscard} /> : null}</>;
}
function renderAccount({registered=true, speaker=false, admin=false, path='/dashboard', uid=user.uid, compact=false, onNavigate, unsaved=false, blocked=false} = {}) {
  return render(<MemoryRouter initialEntries={[path]}>
    <AuthContext.Provider value={{user:{...user,uid},loading:false,adminStatus:admin?'admin':'denied'}}>
      <ProfileContext.Provider value={{profile:{registrationStatus:registered?'approved':'pending',speakerId:speaker?'speaker-340':null},status:'ready'}}>
        {unsaved ? <GuardedAccount blocked={blocked} onNavigate={onNavigate}/>
          : <Account compact={compact} onNavigate={onNavigate}/>}
      </ProfileContext.Provider>
    </AuthContext.Provider>
  </MemoryRouter>);
}
beforeEach(() => {
  demo.static = false;
  demo.event = {};
  sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => ({ok:true, json:async () => ({speaker:{status:'approved'}})})));
});

describe('read-only demo account entry points', () => {
  it.each([
    ['static', 'links'], ['historical', 'links'], ['static', 'select'], ['historical', 'select'],
  ])('hides role controls and admin entry for a %s demo with %s presentation', (mode, presentation) => {
    demo.static = mode === 'static';
    demo.event = { historicalDemo: mode === 'historical' };
    const account = {
      views: [
        { id: 'attendee', label: 'Attendee', to: '/dashboard' },
        { id: 'admin', label: 'Admin', to: '/admin' },
      ],
      current: { id: 'attendee', label: 'Attendee' },
      select: vi.fn(),
    };
    render(<MemoryRouter>
      <RoleSwitcher account={account} presentation={presentation} />
      <AdminEntryLink account={account} />
    </MemoryRouter>);
    expect(screen.queryByRole('navigation', { name: 'Account views' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Manage event' })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('link', { hidden: true })).toHaveLength(0);
    expect(screen.queryByRole('combobox', { name: 'View' })).not.toBeInTheDocument();
  });
});

describe('account visibility rules (issue 340)', () => {
  it.each([
    ['attendee only',true,false,false], ['speaker only',false,true,false], ['admin only',false,false,true],
  ])('shows neither switcher nor admin link for %s', async (_name,registered,speaker,admin) => {
    renderAccount({registered,speaker,admin, path:speaker?'/speaker/dashboard':admin?'/admin':'/dashboard'});
    await waitFor(() => expect(screen.getByRole('link',{name:'Dashboard'})).toHaveAttribute('href',speaker?'/speaker/dashboard':admin?'/admin':'/dashboard'));
    expect(screen.queryByRole('navigation',{name:'Account views'})).not.toBeInTheDocument();
    expect(screen.queryByRole('link',{name:'Manage event'})).not.toBeInTheDocument();
  });
  it('offers all three views and admin home to a multi-role admin', async () => {
    renderAccount({speaker:true,admin:true});
    await waitFor(() => expect(screen.getByRole('link',{name:'Speaker',hidden:true})).toBeInTheDocument());
    fireEvent.click(screen.getByText('Account',{exact:true}));
    const nav = screen.getByRole('navigation',{name:'Account views'});
    expect(within(nav).getAllByRole('link').map(link=>link.textContent)).toEqual(['Attendee','Speaker','Admin']);
    expect(within(nav).getByRole('link',{name:'Attendee'})).toHaveAttribute('aria-current','true');
    expect(screen.getByRole('link',{name:'Manage event'})).toHaveAttribute('href','/admin');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('offers two views without an admin link to an attendee and speaker', async () => {
    renderAccount({speaker:true});
    await waitFor(() => expect(screen.getByRole('link',{name:'Speaker',hidden:true})).toBeInTheDocument());
    expect(screen.queryByRole('link',{name:'Admin',hidden:true})).not.toBeInTheDocument();
    expect(screen.queryByRole('link',{name:'Manage event'})).not.toBeInTheDocument();
  });
  it('does not expose speaker controls for a linked draft', async () => {
    fetch.mockResolvedValue({ok:true,json:async()=>({speaker:{status:'draft'}})});
    renderAccount({speaker:true});
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByText('Account',{exact:true})).not.toBeInTheDocument();
  });
});

describe('view selection', () => {
  it('offers every available view in the compact selector and navigates with the saved choice', async () => {
    const onNavigate = vi.fn();
    renderAccount({speaker:true,admin:true,path:'/admin',compact:true,onNavigate});
    const select = () => screen.getByRole('combobox', {name:'View'});
    await waitFor(() => expect(within(select()).getByRole('option', {name:'Speaker'})).toBeInTheDocument());
    expect(within(select()).getAllByRole('option').map(option => option.textContent)).toEqual(['Attendee','Speaker','Admin']);
    expect(select()).toHaveValue('admin');
    fireEvent.change(select(), {target:{value:'speaker'}});
    expect(screen.getByText('/admin')).toBeInTheDocument();
    expect(screen.getByRole('link', {name:'Dashboard'})).toHaveAttribute('href','/admin');
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('link', {name:'Open'}));
    expect(screen.getByText('/speaker/dashboard')).toBeInTheDocument();
    expect(select()).toHaveValue('speaker');
    expect(onNavigate).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('link', {name:'Schedule'}));
    expect(select()).toHaveValue('speaker');
    expect(screen.getByRole('link', {name:'Dashboard'})).toHaveAttribute('href','/speaker/dashboard');
    fireEvent.change(select(), {target:{value:'attendee'}});
    fireEvent.click(screen.getByRole('link', {name:'Open'}));
    expect(screen.getByText('/dashboard')).toBeInTheDocument();
    expect(select()).toHaveValue('attendee');
    fireEvent.change(select(), {target:{value:'admin'}});
    fireEvent.click(screen.getByRole('link', {name:'Open'}));
    expect(screen.getByText('/admin')).toBeInTheDocument();
    expect(select()).toHaveValue('admin');
  });

  it('keeps dirty edits until Open is confirmed, restores focus on Stay, and leaves only after discard', () => {
    const onNavigate = vi.fn();
    renderAccount({admin:true,path:'/admin/pages/edit',unsaved:true,onNavigate});
    fireEvent.change(screen.getByRole('combobox', {name:'View'}), {target:{value:'attendee'}});
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    const open = screen.getByRole('link', {name:'Open'});
    open.focus();
    fireEvent.click(open);
    expect(screen.getByRole('alertdialog', {name:'Unsaved changes'})).toBeInTheDocument();
    expect(screen.getByText('/admin/pages/edit')).toBeInTheDocument();
    expect(screen.getByRole('link', {name:'Dashboard'})).toHaveAttribute('href','/admin');
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name:'Stay'}));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(open).toHaveFocus();
    expect(screen.getByText('/admin/pages/edit')).toBeInTheDocument();
    fireEvent.click(open);
    fireEvent.click(screen.getByRole('button', {name:'Discard changes'}));
    expect(screen.getByText('/dashboard')).toBeInTheDocument();
    expect(screen.getByRole('combobox', {name:'View'})).toHaveValue('attendee');
  });

  it('keeps Open from leaving while an editor save is running', () => {
    renderAccount({admin:true,path:'/admin/pages/edit',unsaved:true,blocked:true});
    fireEvent.change(screen.getByRole('combobox', {name:'View'}), {target:{value:'attendee'}});
    fireEvent.click(screen.getByRole('link', {name:'Open'}));
    expect(screen.getByRole('alertdialog', {name:'Unsaved changes'})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name:'Discard changes'})).not.toBeInTheDocument();
    expect(screen.getByText('/admin/pages/edit')).toBeInTheDocument();
  });

  it.each([
    {views:[]}, {views:[{id:'admin',label:'Admin',to:'/admin'}]},
  ])('hides the compact selector when there is no choice: $views', ({views}) => {
    render(<MemoryRouter><RoleSwitcher account={{views,current:views[0]}} presentation="select" /></MemoryRouter>);
    expect(screen.queryByRole('combobox', {name:'View'})).not.toBeInTheDocument();
  });

  it('switches, closes the menu, and keeps the choice on another page', async () => {
    renderAccount({speaker:true,admin:true});
    await waitFor(() => expect(screen.getByRole('link',{name:'Speaker',hidden:true})).toBeInTheDocument());
    fireEvent.click(screen.getByText('Account',{exact:true}));
    fireEvent.click(screen.getByRole('link',{name:'Speaker',exact:true}));
    expect(screen.getByText('/speaker/dashboard')).toBeInTheDocument();
    expect(screen.getByText('Account',{exact:true}).closest('details')).not.toHaveAttribute('open');
    fireEvent.click(screen.getByRole('link',{name:'Schedule'}));
    expect(screen.getByText('View as: Speaker')).toBeInTheDocument();
    expect(screen.getByRole('link',{name:'Dashboard'})).toHaveAttribute('href','/speaker/dashboard');
    fireEvent.click(screen.getByText('Account',{exact:true}));
    expect(screen.getByRole('link',{name:'Speaker',exact:true})).toHaveAttribute('aria-current','true');
    expect(screen.getByRole('link',{name:'Attendee',exact:true})).not.toHaveAttribute('aria-current');
  });
  it('restores a session selection and lets role deep links win', () => {
    saveSessionView(user.uid,'admin');
    const view = renderAccount({admin:true,path:'/schedule'});
    expect(screen.getByRole('link',{name:'Dashboard'})).toHaveAttribute('href','/admin');
    view.unmount();
    renderAccount({admin:true,path:'/dashboard'});
    expect(screen.getByRole('link',{name:'Dashboard'})).toHaveAttribute('href','/dashboard');
  });
  it('ignores another account or a role that is no longer held', () => {
    saveSessionView('previous-user','admin');
    saveSessionView(user.uid,'speaker');
    renderAccount({path:'/schedule'});
    expect(screen.getByRole('link',{name:'Dashboard'})).toHaveAttribute('href','/dashboard');
  });
  it('returns focus to Account on Escape', () => {
    renderAccount({admin:true});
    const summary=screen.getByText('Account',{exact:true});
    fireEvent.click(summary);
    fireEvent.keyDown(screen.getByRole('link',{name:'Admin',exact:true}),{key:'Escape'});
    expect(summary.closest('details')).not.toHaveAttribute('open');
    expect(summary).toHaveFocus();
  });
});

describe('phone account sheet', () => {
  it('keeps role links and Close usable without native dialog methods', () => {
    const original = window.matchMedia;
    window.matchMedia = () => ({matches:true,addEventListener:()=>{},removeEventListener:()=>{}});
    const showModal = HTMLDialogElement.prototype.showModal;
    const close = HTMLDialogElement.prototype.close;
    HTMLDialogElement.prototype.showModal = undefined;
    HTMLDialogElement.prototype.close = undefined;
    try {
      renderAccount({admin:true});
      const trigger = screen.getByRole('button',{name:'Account',exact:true});
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      fireEvent.click(trigger);
      const sheet = screen.getByRole('dialog',{name:'Account'});
      expect(sheet).toHaveAttribute('open');
      expect(within(sheet).getByRole('link',{name:'Admin',exact:true})).toBeVisible();
      expect(document.documentElement.style.overflow).toBe('hidden');
      const closeControl = within(sheet).getByRole('button',{name:'Close',exact:true});
      const lastRole = within(sheet).getByRole('link',{name:'Admin',exact:true});
      fireEvent.keyDown(closeControl,{key:'Tab',shiftKey:true});
      expect(lastRole).toHaveFocus();
      fireEvent.keyDown(lastRole,{key:'Tab'});
      expect(closeControl).toHaveFocus();
      screen.getByRole('link',{name:'Schedule'}).focus();
      expect(closeControl).toHaveFocus();
      fireEvent.click(within(sheet).getByRole('button',{name:'Close',exact:true}));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
      fireEvent.click(trigger);
      fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(document.documentElement.style.overflow).toBe('');
      expect(trigger).toHaveFocus();
    } finally {
      HTMLDialogElement.prototype.showModal = showModal;
      HTMLDialogElement.prototype.close = close;
      if(original) window.matchMedia=original;
      else delete window.matchMedia;
    }
  });

  it('opens a modal sheet, locks scrolling, and restores focus on Close', async () => {
    const original = window.matchMedia;
    window.matchMedia = () => ({matches:true,addEventListener:()=>{},removeEventListener:()=>{}});
    try {
      renderAccount({admin:true});
      const trigger=screen.getByRole('button',{name:'Account',exact:true});
      fireEvent.click(trigger);
      expect(screen.getByRole('dialog',{name:'Account'})).toHaveAttribute('open');
      expect(document.documentElement.style.overflow).toBe('hidden');
      fireEvent.click(screen.getByRole('button',{name:'Close',exact:true}));
      expect(screen.queryByRole('dialog',{name:'Account'})).not.toBeInTheDocument();
      expect(document.documentElement.style.overflow).toBe('');
      expect(trigger).toHaveFocus();
    } finally {
      if(original) window.matchMedia=original;
      else delete window.matchMedia;
    }
  });
});
