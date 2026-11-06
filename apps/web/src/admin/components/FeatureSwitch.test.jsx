import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { KNOWN_FEATURE_KEYS } from 'shared/config';
import FeatureSwitch from './FeatureSwitch.jsx';

let config;
const call = vi.fn();
vi.mock('../../contexts/AuthContext.jsx', () => ({ useAuth: () => ({ isOperator: true }) }));
vi.mock('../../contexts/EventConfigContext.jsx', () => ({ useEventConfig: () => config }));
vi.mock('../adminApi.js', () => ({ useAdminApi: () => call }));

beforeEach(() => {
  call.mockReset();
  config = { features: { schedule: true, badges: false, customBadges: true }, sources: { features: 'live' } };
});

describe('in-page feature saves', () => {
  it('waits for the features document even when another config document is live', () => {
    config.sources = { features: 'snapshot', event: 'live' };
    render(<FeatureSwitch featureKeys={['badges']} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Attendee badges' }));
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(call).not.toHaveBeenCalled();
  });

  it('preserves other flags, blocks overlapping saves, and waits for live confirmation', async () => {
    let resolve;
    call.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const view = render(<FeatureSwitch featureKeys={['badges', 'customBadges']} />);
    const badges = screen.getByRole('switch', { name: 'Attendee badges' });
    const custom = screen.getByRole('switch', { name: 'Custom badges' });
    fireEvent.click(badges);
    fireEvent.click(custom);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith('updateFeatures', {
      features: Object.fromEntries(KNOWN_FEATURE_KEYS.map((key) => [key, ['schedule', 'badges', 'customBadges'].includes(key)])),
    });
    await act(async () => resolve({ docPath: 'config/features' }));
    expect(badges).not.toBeChecked();
    expect(custom).toBeDisabled();
    config = { ...config, features: { ...config.features, badges: true } };
    view.rerender(<FeatureSwitch featureKeys={['badges', 'customBadges']} />);
    expect(badges).toBeChecked();
    expect(custom).toBeEnabled();
    call.mockResolvedValueOnce({});
    fireEvent.click(custom);
    expect(call.mock.calls[1][1].features).toMatchObject({ badges: true, customBadges: false, schedule: true });
    await act(async () => {});
  });

  it('keeps the saved state and allows a retry when the server rejects a change', async () => {
    call.mockRejectedValueOnce(new Error('Could not save the feature setting.'));
    render(<FeatureSwitch featureKeys={['badges']} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the feature setting.');
    expect(screen.getByRole('switch')).not.toBeChecked();
    expect(screen.getByRole('switch')).toBeEnabled();
    expect(screen.queryByText(/setting saved/)).toBeNull();
  });
});
