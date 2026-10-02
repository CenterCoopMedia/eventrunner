import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AnnouncementBanners from './AnnouncementBanners.jsx';

let report = () => {};
vi.mock('../lib/announcementsSource.js', () => ({
  subscribeAnnouncements: vi.fn((onNext) => {
    report = onNext;
    return () => {};
  }),
}));

describe('AnnouncementBanners', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-02T14:00:00.000Z'));
  });

  it('shows every active row, sanitizes stored text and links, and excludes inactive rows', () => {
    render(<AnnouncementBanners />);
    act(() => report([
      {
        id: 'active',
        message: '<script>Use the east entrance.</script>',
        level: 'urgent',
        startsAt: '2026-10-02T13:00:00.000Z',
        endsAt: '2026-10-02T15:00:00.000Z',
        link: { url: 'https://example.org/details', label: '<b>Read details</b>' },
      },
      {
        id: 'future',
        message: 'Later',
        level: 'info',
        startsAt: '2026-10-02T16:00:00.000Z',
        endsAt: '2026-10-02T17:00:00.000Z',
      },
      {
        id: 'unsafe-link',
        message: 'Registration update',
        level: 'info',
        startsAt: '2026-10-02T13:00:00.000Z',
        endsAt: '2026-10-02T15:00:00.000Z',
        link: { url: 'javascript:alert(1)', label: 'Unsafe' },
      },
    ]));

    expect(screen.getByRole('alert')).toHaveTextContent('Use the east entrance.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('script');
    expect(screen.getByRole('link', { name: /Read details/ })).toHaveAttribute(
      'href',
      'https://example.org/details',
    );
    expect(screen.getByText('Registration update')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Unsafe' })).toBeNull();
    expect(screen.queryByText('Later')).toBeNull();
  });

  it('stays dismissed in this browser while another active row remains visible', () => {
    render(<AnnouncementBanners />);
    act(() => report([
      {
        id: 'first', message: 'First notice', level: 'info',
        startsAt: '2026-10-02T13:00:00.000Z', endsAt: '2026-10-02T15:00:00.000Z',
      },
      {
        id: 'second', message: 'Second notice', level: 'info',
        startsAt: '2026-10-02T13:30:00.000Z', endsAt: '2026-10-02T15:00:00.000Z',
      },
    ]));
    const firstBar = screen.getByText('First notice').closest('[role="status"]');
    fireEvent.click(firstBar.querySelector('button'));
    expect(screen.queryByText('First notice')).toBeNull();
    expect(screen.getByText('Second notice')).toBeInTheDocument();
    expect(localStorage.getItem('notice-dismissed:first')).toBe('1');
  });
});
