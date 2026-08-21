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
});
