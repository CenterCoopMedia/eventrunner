import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callApi } from '../../api.js';
import { renderPage } from '../../test/renderPage.jsx';
import ReviewQueue from './ReviewQueue.jsx';

vi.mock('../../api.js', () => ({ callApi: vi.fn() }));

const queue = (status, applications) => ({ status, applications });
const app = (overrides = {}) => ({
  id: 'a1',
  orgId: 'o1',
  organizationName: 'NC Local',
  eventName: 'NC Local Summit',
  webAddressName: 'nclocal',
  status: 'approved',
  submittedAt: '2026-11-03T15:00:00.000Z',
  updatedAt: '2026-11-03T15:00:00.000Z',
  ...overrides,
});

const page = (path = '/review') => renderPage(<ReviewQueue />, { path, route: '/review' });

beforeEach(() => {
  callApi.mockImplementation(async (name, body) => queue(body.status, body.status === 'approved' ? [app()] : []));
});

describe('ReviewQueue', () => {
  it('lists the approved requests by default, with the organization and the web address', async () => {
    page();
    expect(await screen.findByRole('heading', { level: 1, name: 'Review requests' })).toBeInTheDocument();
    expect(callApi).toHaveBeenCalledWith('listApplicationsForReview', { status: 'approved' });
    const items = within(await screen.findByRole('list', { name: 'Approved' })).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('NC Local Summit');
    expect(items[0]).toHaveTextContent('NC Local');
    expect(items[0]).toHaveTextContent('nclocal.eventrunner.org');
    expect(within(items[0]).getByRole('link', { name: 'NC Local Summit' })).toHaveAttribute('href', '/review/a1');
  });

  it('filters by status with links that say which filter is on', async () => {
    page();
    const nav = await screen.findByRole('navigation', { name: 'Filter by status' });
    expect(within(nav).getByRole('link', { name: 'Approved' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(within(nav).getByRole('link', { name: 'Declined' }));
    expect(await screen.findByText('No requests here. Choose another status or create a signup link.')).toBeInTheDocument();
    expect(callApi).toHaveBeenLastCalledWith('listApplicationsForReview', { status: 'declined' });
    expect(within(nav).getByRole('link', { name: 'Declined' })).toHaveAttribute('aria-current', 'page');
  });

  it('reads the filter from the address and ignores an unknown one', async () => {
    page('/review?status=ready');
    await screen.findByRole('heading', { level: 2, name: 'Ready' });
    expect(callApi).toHaveBeenCalledWith('listApplicationsForReview', { status: 'ready' });
    page('/review?status=nonsense');
    expect(callApi).toHaveBeenLastCalledWith('listApplicationsForReview', { status: 'approved' });
  });

  it('tells a reader who is not on the hosting team that the page is not for them', async () => {
    callApi.mockRejectedValue(Object.assign(new Error('This page is for the hosting team.'), { code: 'not-operator' }));
    page();
    expect(await screen.findByRole('heading', { level: 1, name: 'This page is for the hosting team' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Filter by status' })).not.toBeInTheDocument();
  });

  it('shows any other load error', async () => {
    callApi.mockRejectedValue(new Error('We could not reach the server.'));
    page();
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not reach the server.');
  });

  it('links to the signup links and the console settings', async () => {
    page();
    expect(await screen.findByRole('link', { name: 'Signup links' })).toHaveAttribute('href', '/review/links');
    expect(await screen.findByRole('link', { name: 'Console settings' })).toHaveAttribute('href', '/review/settings');
  });
});
