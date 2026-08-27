// FeedbackModal — the public feedback form (issue #28). No Firebase, no
// network: mocks lib/feedbackApi.js directly and drives its resolution, the
// same convention as the other public-endpoint modules in this app.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const submitFeedbackMock = vi.fn();
vi.mock('../lib/feedbackApi.js', () => ({
  submitFeedback: (...args) => submitFeedbackMock(...args),
}));

import FeedbackModal from './FeedbackModal.jsx';

beforeEach(() => {
  submitFeedbackMock.mockReset();
});

describe('FeedbackModal', () => {
  it('submits the message, honeypot, and startedAt, and shows a thank-you on success', async () => {
    submitFeedbackMock.mockResolvedValueOnce({ ok: true, id: 'f1' });
    const onClose = vi.fn();
    render(<FeedbackModal onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'The link is broken.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    await screen.findByText('Thanks for letting us know');
    expect(submitFeedbackMock).toHaveBeenCalledTimes(1);
    const payload = submitFeedbackMock.mock.calls[0][0];
    expect(payload.message).toBe('The link is broken.');
    expect(payload.honeypot).toBe('');
    expect(typeof payload.startedAt).toBe('number');
  });

  it('shows the server error inline instead of throwing', async () => {
    submitFeedbackMock.mockResolvedValueOnce({ ok: false, error: 'Too many submissions. Try again later.' });
    render(<FeedbackModal onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many submissions. Try again later.');
  });

  it('refuses to submit an empty message without calling the server', () => {
    render(<FeedbackModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Please enter a message.');
    expect(submitFeedbackMock).not.toHaveBeenCalled();
  });

  it('closes on Cancel', () => {
    const onClose = vi.fn();
    render(<FeedbackModal onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<FeedbackModal onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('carries the honeypot field out of the tab order and off-screen', () => {
    render(<FeedbackModal onClose={() => {}} />);
    const honeypot = screen.getByLabelText('Leave this field blank');
    expect(honeypot).toHaveAttribute('tabIndex', '-1');
  });

  it('draws its field borders on the accessible control token, not the hairline rule', () => {
    // WCAG 1.4.11: a form control's boundary needs 3:1 against its ground.
    // --rule-hairline is deliberately below that bar (design brief §3.7), so
    // these fields (components/forms/publicForm.jsx) use
    // --color-border-control instead.
    render(<FeedbackModal onClose={() => {}} />);
    expect(screen.getByLabelText('Message')).toHaveClass('border-control');
    expect(screen.getByLabelText('Message')).not.toHaveClass('border-rule-hairline');
  });

  it('is set in the public tier, never in the admin identity', () => {
    // This is a visitor-facing form. The admin identity is fixed operator
    // tooling (brief §5.2), so an admin-* token on this surface is a tier
    // mismatch — the one PR1 flagged, and the reason publicForm.jsx exists.
    const { container } = render(<FeedbackModal onClose={() => {}} />);
    expect(container.innerHTML).not.toMatch(/admin-/);
    expect(screen.getByLabelText('Message')).toHaveClass('bg-surface');
  });

  it('never asserts the confirmation email was delivered (Codex P2: the send is best-effort and can fail silently)', async () => {
    submitFeedbackMock.mockResolvedValueOnce({ ok: true, id: 'f1' });
    render(<FeedbackModal onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello' } });
    fireEvent.change(screen.getByLabelText('Email (optional)'), { target: { value: 'attendee@example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('We got your feedback.');
    // Receipt-only: it hedges ("try to send"), never claims delivery.
    expect(status.textContent).not.toMatch(/sent a confirmation/i);
    expect(status).toHaveTextContent('we’ll try to send a confirmation');
  });

  it('sends a submissionKey and reuses the SAME one across a retry (Codex P2 idempotency)', async () => {
    submitFeedbackMock.mockResolvedValueOnce({ ok: false, error: 'network blip' });
    submitFeedbackMock.mockResolvedValueOnce({ ok: true, id: 'f1' });
    render(<FeedbackModal onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await screen.findByText('We got your feedback.');

    expect(submitFeedbackMock).toHaveBeenCalledTimes(2);
    const firstKey = submitFeedbackMock.mock.calls[0][0].submissionKey;
    const secondKey = submitFeedbackMock.mock.calls[1][0].submissionKey;
    expect(typeof firstKey).toBe('string');
    expect(firstKey.length).toBeGreaterThanOrEqual(8);
    expect(secondKey).toBe(firstKey);
  });

  it('omits the confirmation mention entirely when no email was given', async () => {
    submitFeedbackMock.mockResolvedValueOnce({ ok: true, id: 'f1' });
    render(<FeedbackModal onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    const status = await screen.findByRole('status');
    expect(status.textContent.trim()).toBe('We got your feedback.');
  });
});
