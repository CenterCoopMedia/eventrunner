import { fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { callApi } from './api.js';
import ReportProblem from './ReportProblem.jsx';
import { renderPage } from './test/renderPage.jsx';

vi.mock('./api.js', () => ({ callApi: vi.fn() }));

it('closes the report with its named icon and returns focus to the opener', () => {
  renderPage(<ReportProblem />);
  const opener = screen.getByRole('button', { name: 'Report a problem' });
  fireEvent.click(opener);
  expect(screen.getByLabelText('What happened?')).toHaveFocus();
  const close = screen.getByRole('button', { name: 'Close report' });
  expect(close).toHaveAttribute('title', 'Close report');
  fireEvent.click(close);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
  expect(callApi).not.toHaveBeenCalled();
});

it('keeps the report open after sending and returns focus when the success is closed', async () => {
  callApi.mockResolvedValue({});
  renderPage(<ReportProblem />);
  const opener = screen.getByRole('button', { name: 'Report a problem' });
  fireEvent.click(opener);
  fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'The event name did not save.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Report sent.');
  expect(callApi).toHaveBeenCalledWith('reportProblem', expect.objectContaining({
    category: 'bug', description: 'The event name did not save.', surface: 'console',
  }));
  fireEvent.click(screen.getByRole('button', { name: 'Close report' }));
  expect(opener).toHaveFocus();
});
