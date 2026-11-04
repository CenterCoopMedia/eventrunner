import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { callApi } from '../api.js';
import { renderPage } from '../test/renderPage.jsx';
import CreateOrganization from './CreateOrganization.jsx';

vi.mock('../api.js', () => ({ callApi: vi.fn() }));

const page = (options = {}) => renderPage(<CreateOrganization />, {
  path: '/organizations/new',
  routes: { '/organizations/:orgId/team': 'Team page' },
  ...options,
});

describe('CreateOrganization', () => {
  it('asks for the organization name with a real label and says what it is for', () => {
    page();
    expect(screen.getByRole('heading', { level: 1, name: 'Name your organization' })).toBeInTheDocument();
    expect(screen.getByLabelText('Organization name')).toHaveAttribute('type', 'text');
    expect(screen.getByText(/more than one event/)).toBeInTheDocument();
  });

  it('creates the organization and opens its team page', async () => {
    callApi.mockResolvedValue({ organization: { id: 'o7', name: 'Local News Lab', role: 'owner' } });
    page();
    fireEvent.change(screen.getByLabelText('Organization name'), { target: { value: 'Local News Lab' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));
    expect(await screen.findByText('Team page')).toBeInTheDocument();
    expect(callApi).toHaveBeenCalledWith('createOrganization', { name: 'Local News Lab' });
  });

  it('checks the name on submit and moves focus to the field', async () => {
    page();
    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));
    const field = screen.getByLabelText('Organization name');
    expect(await screen.findByText('Enter a name of 2 to 100 characters.')).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveFocus();
    expect(callApi).not.toHaveBeenCalled();
  });

  it('shows the server refusal', async () => {
    callApi.mockRejectedValue(new Error('You have made too many organizations today. Try again tomorrow.'));
    page();
    fireEvent.change(screen.getByLabelText('Organization name'), { target: { value: 'Another Org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('too many organizations today');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create organization' })).toBeEnabled());
  });
});
