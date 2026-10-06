import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Link, useLocation } from 'react-router-dom';
import AuthContext from '../contexts/AuthContext.jsx';
import ProfileContext from '../contexts/ProfileContext.jsx';
import useAccountViews from '../hooks/useAccountViews.js';
import AccountMenu from './AccountMenu.jsx';
import AdminEntryLink from './AdminEntryLink.jsx';
import RoleSwitcher from './RoleSwitcher.jsx';
import { saveSessionView } from '../lib/accountViews.js';

const demo = vi.hoisted(() => ({ static: false, event: {} }));
vi.mock('../lib/demoMode.js', () => ({ get IS_DEMO() { return demo.static; } }));
vi.mock('../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ eventConfig: demo.event }),
}));

const user = {uid:'fixture-340', getIdToken: async () => 'fixture-token'};
function Account() {
  const account = useAccountViews();
  const {pathname} = useLocation();
  return <><p>{pathname}</p><Link to={account.current?.to ?? '/signin'}>Dashboard</Link>
    {account.views.length > 1 ? <AccountMenu account={account}/> : null}<AdminEntryLink account={account}/><Link to="/schedule">Schedule</Link></>;
}
function renderAccount({registered=true, speaker=false, admin=false, path='/dashboard', uid=user.uid} = {}) {
  return render(<MemoryRouter initialEntries={[path]} future={{v7_startTransition:true, v7_relativeSplatPath:true}}>
    <AuthContext.Provider value={{user:{...user,uid},loading:false,adminStatus:admin?'admin':'denied'}}>
      <ProfileContext.Provider value={{profile:{registrationStatus:registered?'approved':'pending',speakerId:speaker?'speaker-340':null},status:'ready'}}>
        <Account/>
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
  it.each(['static', 'historical'])('hides role links and admin entry for a %s demo', (mode) => {
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
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <RoleSwitcher account={account} />
      <AdminEntryLink account={account} />
    </MemoryRouter>);
    expect(screen.queryByRole('navigation', { name: 'Account views' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Manage event' })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('link', { hidden: true })).toHaveLength(0);
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
