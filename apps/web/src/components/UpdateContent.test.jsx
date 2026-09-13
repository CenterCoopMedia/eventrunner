import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import UpdateContent, { UpdateImage } from './UpdateContent.jsx';

const poll = { type: 'practicePoll', question: 'Choose a workshop', options: ['Reporting', 'Revenue'] };
describe('UpdateContent', () => {
  it('renders safe media, columns and an internal action', () => {
    render(<MemoryRouter><UpdateImage image={{ url: 'demo/summit-gathering.webp', alt: 'Summit scene' }} /><UpdateContent content={[
      { type: 'columns', columns: [{ heading: 'Before', body: '<p>Pack notes</p>' }, { heading: 'After', body: '<p>Share notes</p>' }] },
      { type: 'button', label: 'See schedule', href: '/schedule' },
    ]} /></MemoryRouter>);
    expect(screen.getByAltText('Summit scene')).toHaveAttribute('src', expect.stringContaining('/demo/summit-gathering.webp'));
    expect(screen.getByRole('heading', { name: 'Before' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See schedule' })).toHaveAttribute('href', '/schedule');
  });
  it('preserves preview parameters while retaining button query parameters', () => {
    render(<MemoryRouter initialEntries={['/updates/example?preview=1&theme=zine']}>
      <UpdateContent content={[{ type: 'button', label: 'Choose a day', href: '/schedule?day=day-2' }]} />
    </MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Choose a day' })).toHaveAttribute(
      'href', '/schedule?day=day-2&preview=1&theme=zine',
    );
  });

  it('keeps poll choices local and reports no totals', () => {
    render(<UpdateContent content={[poll]} />);
    expect(screen.getByRole('button')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Revenue'));
    fireEvent.click(screen.getByRole('button', { name: 'Try the poll' }));
    expect(screen.getByRole('status')).toHaveTextContent('You chose: Revenue. This is a preview, not a submitted vote.');
    fireEvent.click(screen.getByLabelText('Reporting'));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
  it('rejects unsafe URLs and sanitizes formatted text', () => {
    const { container } = render(<UpdateContent content={[
      { type: 'button', label: 'Bad', href: 'javascript:alert(1)' },
      { type: 'image', image: { url: 'data:image/svg+xml,test', alt: 'Bad image' } },
      { type: 'richtext', value: '<p>Safe text</p><script>alert(1)</script><img src=x onerror=alert(1)>' },
    ]} />);
    expect(screen.getByText('Safe text')).toBeInTheDocument();
    expect(container.querySelector('script, img, a')).toBeNull();
  });
  it('ignores malformed published blocks without crashing the post', () => {
    const { container } = render(<UpdateContent content={[
      null, [], { type: 'columns', columns: [null, {}] },
      { type: 'image', image: { alt: 'Broken', url: { toString: 'invalid' } } },
      { type: 'practicePoll', question: 'Broken', options: [null, {}] },
      { type: 'richtext', value: '<p>Remaining copy</p>' },
    ]} />);
    expect(screen.getByText('Remaining copy')).toBeInTheDocument();
    expect(container.querySelector('img, form')).toBeNull();
  });

});
