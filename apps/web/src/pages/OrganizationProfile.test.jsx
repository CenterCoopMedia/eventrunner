// A representative's own organization page (issue #334), /profile/organization.
// It loads through ownOrganizationProfile, shows the live profile and any
// edit still waiting for review, and sends only the three fields a
// representative may change.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

let authValue;
const showToastMock = vi.fn();

vi.mock('../contexts/AuthContext.jsx', () => ({
  useAuth: () => authValue,
}));
vi.mock('../contexts/ToastContext.jsx', () => ({
  useToast: () => ({ showToast: showToastMock }),
}));
vi.mock('../components/SignInPanel.jsx', () => ({
  default: () => <div data-testid="sign-in-panel">sign-in form</div>,
}));
vi.mock('../components/media/AssetImage.jsx', () => ({
  default: ({ path }) => <span data-testid="logo">{path}</span>,
}));

const getOwnOrganizationMock = vi.fn();
const submitOrganizationEditMock = vi.fn();
vi.mock('../lib/organizationProfileApi.js', () => ({
  getOwnOrganization: (...args) => getOwnOrganizationMock(...args),
  submitOrganizationEdit: (...args) => submitOrganizationEditMock(...args),
}));

const { default: OrganizationProfile } = await import('./OrganizationProfile.jsx');

const LIVE = {
  organizationId: 'beacon-fund',
  organization: {
    name: 'Beacon Fund',
    logoPath: 'cms-images/beacon.webp',
    description: 'Funds the travel grants.',
    bio: 'Beacon has funded local reporting since 2010.',
    url: 'https://beacon.example.org/',
  },
  pending: null,
};

function renderPage() {
  return render(
    <MemoryRouter>
      <OrganizationProfile />
    </MemoryRouter>,
  );
}

function refusal(code, message) {
  return Object.assign(new Error(message), { code, status: 403 });
}

beforeEach(() => {
  authValue = { user: { uid: 'uid-ada', getIdToken: async () => 't' } };
  getOwnOrganizationMock.mockReset().mockResolvedValue(LIVE);
  submitOrganizationEditMock.mockReset();
  showToastMock.mockClear();
});

describe('OrganizationProfile', () => {
  it('shows sign-in in place for a signed-out visitor and asks the server nothing', () => {
    authValue = { user: null };
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in to edit your organization' })).toBeInTheDocument();
    expect(screen.getByTestId('sign-in-panel')).toBeInTheDocument();
    expect(getOwnOrganizationMock).not.toHaveBeenCalled();
  });

  it('tells an account that represents no organization so, and shows no form', async () => {
    getOwnOrganizationMock.mockRejectedValue(refusal('not-representative', 'No grant.'));
    renderPage();
    expect(await screen.findByText('This account does not represent an organization')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send for review' })).not.toBeInTheDocument();
  });

  it('says an organization that is not on the site yet cannot be edited', async () => {
    getOwnOrganizationMock.mockResolvedValue({ organizationId: 'new-grant', organization: null, pending: null });
    renderPage();
    expect(await screen.findByText('Your organization is not on the site yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send for review' })).not.toBeInTheDocument();
  });

  it('fills the form from the live profile, names the organization, and links its public page', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Beacon Fund' })).toBeInTheDocument();
    expect(screen.getByLabelText('Short description')).toHaveValue('Funds the travel grants.');
    expect(screen.getByLabelText('About your organization')).toHaveValue('Beacon has funded local reporting since 2010.');
    expect(screen.getByLabelText('Website')).toHaveValue('https://beacon.example.org/');
    expect(screen.getByRole('link', { name: /See your public page/ })).toHaveAttribute('href', '/sponsors/beacon-fund');
    // Staff-owned fields are not offered at all.
    expect(screen.queryByLabelText(/tier/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^name$/i)).not.toBeInTheDocument();
    expect(screen.getByText(/The event team reviews your changes/)).toBeInTheDocument();
  });

  it('sends the three fields for review and then says they are waiting', async () => {
    submitOrganizationEditMock.mockResolvedValue({
      organizationId: 'beacon-fund',
      pending: { fields: { description: 'Funds travel and child care.' }, submittedAt: '2026-10-20T10:00:00.000Z' },
    });
    renderPage();
    const description = await screen.findByLabelText('Short description');
    fireEvent.change(description, { target: { value: 'Funds travel and child care.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send for review' }));

    await waitFor(() => expect(submitOrganizationEditMock).toHaveBeenCalledTimes(1));
    expect(submitOrganizationEditMock).toHaveBeenCalledWith({
      user: authValue.user,
      fields: {
        description: 'Funds travel and child care.',
        bio: 'Beacon has funded local reporting since 2010.',
        url: 'https://beacon.example.org/',
      },
    });
    const note = await screen.findByText(/Your changes are waiting for review/);
    expect(note.closest('[role="status"]')).not.toBeNull();
    expect(showToastMock).toHaveBeenCalledWith('Changes sent. The event team reviews them before they appear.');
  });

  it('opens on a waiting edit: the form shows it, and the note says the page still shows the old text', async () => {
    getOwnOrganizationMock.mockResolvedValue({
      ...LIVE,
      pending: { fields: { bio: 'A newer history.' }, submittedAt: '2026-10-20T10:00:00.000Z' },
    });
    renderPage();
    expect(await screen.findByLabelText('About your organization')).toHaveValue('A newer history.');
    expect(screen.getByLabelText('Short description')).toHaveValue('Funds the travel grants.');
    expect(screen.getByText(/Your changes are waiting for review. Your public page shows the earlier text until the event team publishes them./))
      .toBeInTheDocument();
  });

  it('says when another representative’s edit is waiting, without showing it', async () => {
    getOwnOrganizationMock.mockResolvedValue({ ...LIVE, pending: null, otherPending: true });
    renderPage();
    expect(await screen.findByText(/Another representative of your organization has an edit waiting for review/))
      .toBeInTheDocument();
    expect(screen.getByLabelText('Short description')).toHaveValue('Funds the travel grants.');
  });

  it('names a website that is not a web link and sends nothing', async () => {
    renderPage();
    const website = await screen.findByLabelText('Website');
    fireEvent.change(website, { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send for review' }));
    expect(await screen.findByText('Enter a link that starts with http:// or https://.')).toBeInTheDocument();
    expect(website).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(website).toHaveFocus());
    expect(submitOrganizationEditMock).not.toHaveBeenCalled();
  });

  it('names a description that is too long and sends nothing', async () => {
    renderPage();
    const description = await screen.findByLabelText('Short description');
    fireEvent.change(description, { target: { value: 'd'.repeat(501) } });
    fireEvent.click(screen.getByRole('button', { name: 'Send for review' }));
    expect(await screen.findByText('Use 500 characters or fewer.')).toBeInTheDocument();
    expect(submitOrganizationEditMock).not.toHaveBeenCalled();
  });

  it('puts a server refusal next to the field it names', async () => {
    const error = Object.assign(new Error('url: must start with http:// or https://'), {
      code: 'bad-request',
      status: 400,
      fieldErrors: [{ field: 'url', message: 'url: must start with http:// or https://' }],
    });
    submitOrganizationEditMock.mockRejectedValue(error);
    renderPage();
    await screen.findByLabelText('Website');
    fireEvent.click(screen.getByRole('button', { name: 'Send for review' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('url: must start with http:// or https://')).toBeInTheDocument();
  });

  it('offers a retry when the profile cannot load', async () => {
    getOwnOrganizationMock.mockRejectedValueOnce(Object.assign(new Error('We could not reach the server.'), { code: 'network' }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Beacon Fund' })).toBeInTheDocument();
    expect(getOwnOrganizationMock).toHaveBeenCalledTimes(2);
  });
});
