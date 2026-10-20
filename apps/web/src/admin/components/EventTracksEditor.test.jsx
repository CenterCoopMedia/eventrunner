// The event tracks (issue #475): the same compact controls as the days, a
// remove control that names its own track, and a stated consequence before
// a track that sessions use is removed or relettered.
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import EventTracksEditor, { nextTrackLetter, normalizeTracks, tracksPayload } from './EventTracksEditor.jsx';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const STORED = [{ letter: 'A', name: 'Practice' }, { letter: 'B', name: 'Sustainability' }];

function Harness({ stored = STORED, usage = new Map(), errors = new Map(), onTracks = () => {} }) {
  const [tracks, setTracks] = useState(() => normalizeTracks(stored));
  return (
    <EventTracksEditor
      tracks={tracks}
      onChange={(next) => { setTracks(next); onTracks(next); }}
      errorFor={(field) => errors.get(field)}
      trackUsage={usage}
    />
  );
}

const flush = () => act(() => { vi.runAllTimers(); });

describe('nextTrackLetter', () => {
  it('offers the first letter no track has and no session still names', () => {
    expect(nextTrackLetter([], new Map())).toBe('A');
    expect(nextTrackLetter(normalizeTracks(STORED), new Map([['C', ['Old session']]]))).toBe('D');
    expect(nextTrackLetter(normalizeTracks(Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ', (letter) => ({ letter, name: letter }))), new Map())).toBe('');
  });
});

describe('EventTracksEditor', () => {
  it('adds a track with a free letter from one labelled control and moves focus to its name', () => {
    vi.useFakeTimers();
    const onTracks = vi.fn();
    render(<Harness onTracks={onTracks} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add track' }));
    flush();
    expect(screen.getByLabelText('Track 3 letter')).toHaveValue('C');
    expect(screen.getByLabelText('Track 3 name')).toHaveFocus();
  });

  it('sends each letter as a capital and only the stored fields', () => {
    const onTracks = vi.fn();
    render(<Harness onTracks={onTracks} />);
    fireEvent.change(screen.getByLabelText('Track 2 letter'), { target: { value: 'c' } });
    expect(tracksPayload(onTracks.mock.calls.at(-1)[0])).toEqual([
      { letter: 'A', name: 'Practice' },
      { letter: 'C', name: 'Sustainability' },
    ]);
  });

  it('names the track on its own remove control, inside that track', () => {
    render(<Harness />);
    const first = screen.getByRole('listitem', { name: /Track 1/ });
    expect(within(first).getByRole('button', { name: 'Remove track 1, A Practice' })).toHaveTextContent('Remove');
  });

  it('removes an unused track at once and says it goes on save', () => {
    vi.useFakeTimers();
    const onTracks = vi.fn();
    render(<Harness onTracks={onTracks} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove track 2, B Sustainability' }));
    flush();
    expect(tracksPayload(onTracks.mock.calls.at(-1)[0])).toEqual([STORED[0]]);
    expect(screen.getByRole('status')).toHaveTextContent('Track B, Sustainability, will be removed when you save.');
    expect(screen.getByRole('button', { name: 'Remove track 1, A Practice' })).toHaveFocus();
  });

  it('states what happens to the sessions before removing a track they use', () => {
    vi.useFakeTimers();
    const onTracks = vi.fn();
    render(<Harness onTracks={onTracks} usage={new Map([['A', ['Data desk']]])} />);
    const first = screen.getByRole('listitem', { name: /Track 1/ });
    expect(within(first).getByText('Used by 1 session: Data desk.')).toBeInTheDocument();
    fireEvent.click(within(first).getByRole('button', { name: 'Remove track 1, A Practice' }));
    flush();
    const warning = within(first).getByRole('group', { name: 'Remove track A?' });
    expect(warning).toHaveFocus();
    expect(warning).toHaveTextContent('1 session uses track A. It stays saved, but it loses its track and runs across the whole schedule until you give it another track. Nothing changes until you save.');
    expect(onTracks).not.toHaveBeenCalled();
    fireEvent.click(within(warning).getByRole('button', { name: 'Remove track A anyway' }));
    expect(tracksPayload(onTracks.mock.calls.at(-1)[0])).toEqual([STORED[1]]);
  });

  it('warns, without blocking, when a used track’s letter changes', () => {
    render(<Harness usage={new Map([['A', ['Data desk', 'Audio lab']]])} />);
    fireEvent.change(screen.getByLabelText('Track 1 letter'), { target: { value: 'Z' } });
    expect(screen.getByLabelText('Track 1 letter')).toHaveAccessibleDescription(
      expect.stringContaining('2 sessions use letter A. Change their track too, or they lose it when you save.'),
    );
  });

  it('marks the offending track when the server refuses a letter', () => {
    render(<Harness errors={new Map([['tracks[0].letter', 'must be a single capital letter A-Z, got "AA"']])} />);
    expect(screen.getByLabelText('Track 1 letter')).toHaveAttribute('aria-invalid', 'true');
  });

  it('says plainly that an event with one room needs no tracks', () => {
    render(<Harness stored={[]} />);
    expect(screen.getByText('No tracks configured yet.')).toBeInTheDocument();
  });
});
