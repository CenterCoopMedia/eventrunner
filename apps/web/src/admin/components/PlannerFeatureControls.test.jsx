import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PlannerFeatureControls from './PlannerFeatureControls.jsx';

let operator;
let source;
let features;
const call = vi.fn();
vi.mock('../../contexts/AuthContext.jsx', () => ({ useAuth: () => ({ isOperator: operator }) }));
vi.mock('../../contexts/EventConfigContext.jsx', () => ({ useEventConfig: () => ({ features, sources: { features: source } }) }));
vi.mock('../adminApi.js', () => ({ useAdminApi: () => call }));
const choices = [{ key: 'schedule', label: 'Public schedule' }, { key: 'sessionBookmarks', label: 'Save sessions' }];
beforeEach(() => {
  operator = true; source = 'live'; features = { schedule: false, sessionBookmarks: false, speakers: true, customBadges: false };
  call.mockReset().mockResolvedValue({});
});

describe('page feature switches', () => {
  it('waits for authoritative values and leaves permission enforcement intact', () => {
    source = 'snapshot';
    const { rerender } = render(<PlannerFeatureControls choices={choices} />);
    expect(screen.getByRole('switch', { name: 'Public schedule' })).toBeDisabled();
    fireEvent.click(screen.getByRole('switch', { name: 'Public schedule' }));
    expect(call).not.toHaveBeenCalled();
    operator = false;
    rerender(<PlannerFeatureControls choices={choices} />);
    expect(screen.queryByRole('switch')).toBeNull();
  });
  it('waits for live confirmation of each saved switch and leaves other switches available', async () => {
    const { rerender } = render(<PlannerFeatureControls choices={choices} />);
    const schedule = screen.getByRole('switch', { name: 'Public schedule' });
    const bookmarks = screen.getByRole('switch', { name: 'Save sessions' });
    fireEvent.click(schedule);
    await waitFor(() => expect(bookmarks).not.toBeDisabled());
    expect(schedule).toBeDisabled();
    fireEvent.click(bookmarks);
    await waitFor(() => expect(call).toHaveBeenCalledTimes(2));
    expect(call.mock.calls[1]).toEqual(['updateFeatures', {
      features: { changes: { sessionBookmarks: true }, expected: { sessionBookmarks: false } },
    }]);
    await act(async () => {});
    features = { ...features, schedule: true };
    rerender(<PlannerFeatureControls choices={choices} />);
    expect(schedule).not.toBeDisabled();
    expect(bookmarks).toBeDisabled();
  });
  it('blocks a second write while saving and reports a refusal without changing values', async () => {
    let reject;
    call.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    render(<PlannerFeatureControls choices={choices} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Public schedule' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Save sessions' }));
    expect(call).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error('permission-denied')));
    expect(screen.getByRole('alert')).toHaveTextContent('The setting was not saved. Try again.');
    expect(screen.getByRole('switch', { name: 'Public schedule' })).not.toBeChecked();
  });
});
