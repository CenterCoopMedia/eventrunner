// A live value is read again when the look changes.
//
// The demo banner changes the site style by writing an attribute on the
// document element. Nothing in React's tree hears that, so without this
// hook every measurement in the book would state the value of the style the
// page first rendered in.
import { describe, expect, it } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useLiveToken } from './useLiveToken.js';

function Probe() {
  const value = useLiveToken('--color-surface-rgb');
  return <p data-testid="value">{value ?? 'none'}</p>;
}

describe('useLiveToken', () => {
  it('reads the token on mount', async () => {
    document.documentElement.style.setProperty('--color-surface-rgb', '255 255 255');
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('value')).toHaveTextContent('255 255 255'));
    document.documentElement.style.removeProperty('--color-surface-rgb');
  });

  it('reads it again when the document element changes', async () => {
    document.documentElement.style.setProperty('--color-surface-rgb', '255 255 255');
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('value')).toHaveTextContent('255 255 255'));

    await act(async () => {
      document.documentElement.style.setProperty('--color-surface-rgb', '17 17 17');
      document.documentElement.dataset.mode = 'dark';
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId('value')).toHaveTextContent('17 17 17'));
    delete document.documentElement.dataset.mode;
    document.documentElement.style.removeProperty('--color-surface-rgb');
  });
});
