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
  status: 'submitted',
  submittedAt: '2026-11-03T15:00:00.000Z',
  updatedAt: '2026-11-03T15:00:00.000Z',
  ...overrides,
});

const page = (path = '/review') => renderPage(<ReviewQueue />, { path, route: '/review' });

beforeEach(() => {
  callApi.mockImplementation(async (name, body) => queue(body.status, body.status === 'submitted' ? [app()] : []));
});

describe('ReviewQueue', () => {
  it('lists the requests waiting for review by default, with the organization and the web address', async () => {
    page();
    expect(await screen.findByRole('heading', { level: 1, name: 'Review requests' })).toBeInTheDocument();
    expect(callApi).toHaveBeenCalledWith('listApplicationsForReview', { status: 'submitted' });
    const items = within(await screen.findByRole('list', { name: 'Waiting for review' })).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('NC Local Summit');
    expect(items[0]).toHaveTextContent('NC Local');
    expect(items[0]).toHaveTextContent('nclocal.eventrunner.org');
    expect(within(items[0]).getByRole('link', { name: 'NC Local Summit' })).toHaveAttribute('href', '/review/a1');
  });

  it('filters by status with links that say which filter is on', async () => {
    page();
    const nav = await screen.findByRole('navigation', { name: 'Filter by status' });
    expect(within(nav).getByRole('link', { name: 'Waiting for review' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(within(nav).getByRole('link', { name: 'Declined' }));
    expect(await screen.findByText('No request has this status.')).toBeInTheDocument();
    expect(callApi).toHaveBeenLastCalledWith('listApplicationsForReview', { status: 'declined' });
    expect(within(nav).getByRole('link', { name: 'Declined' })).toHaveAttribute('aria-current', 'page');
  });

  it('reads the filter from the address and ignores an unknown one', async () => {
    page('/review?status=approved');
    await screen.findByRole('heading', { level: 2, name: 'Approved' });
    expect(callApi).toHaveBeenCalledWith('listApplicationsForReview', { status: 'approved' });
    page('/review?status=nonsense');
    expect(callApi).toHaveBeenLastCalledWith('listApplicationsForReview', { status: 'submitted' });
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

  it('links to the console settings', async () => {
    page();
    expect(await screen.findByRole('link', { name: 'Console settings' })).toHaveAttribute('href', '/review/settings');
  });
});
