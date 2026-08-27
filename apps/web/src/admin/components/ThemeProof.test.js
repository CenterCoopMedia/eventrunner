// The page preview's fixtures and its route resolution.
//
// These are the parts that decide WHAT the frame is asked to render, and
// they are worth testing away from the frame itself: mounting the whole
// public app inside the admin, twice, to assert one route string is a slow
// way to learn nothing extra. AdminBranding.test.jsx covers the rendering.
import { describe, expect, it } from 'vitest';
import {
  PROOF_PAGES,
  STRESS_DAY,
  denseSchedule,
  firstPreviewSession,
  proofPath,
} from './ThemeProof.jsx';

const page = (id) => PROOF_PAGES.find((entry) => entry.id === id);

describe('the stress fixture', () => {
  it('packs a day even when the deployment has no sessions at all', () => {
    // The failure this exists for: the fixture used to return the real
    // schedule untouched when there was nothing to draw from, so a brand new
    // deployment — the one most likely to be choosing a style — saw an empty
    // page labelled "stress test".
    const packed = denseSchedule([], STRESS_DAY.id);
    expect(packed.length).toBe(28);
    expect(packed.every((session) => session.dayId === STRESS_DAY.id)).toBe(true);
    expect(packed.every((session) => session.visible === true)).toBe(true);
    expect(packed[0].title).toMatch(/^Roundtable: Sustaining multi-newsroom/);
    expect(packed[1].title).toMatch(/regional newsroom owes the county next door/);
  });

  it('draws on the deployment’s own sessions where there are any', () => {
    const packed = denseSchedule(
      [{ id: 'a', title: 'Opening remarks', visible: true }],
      'day-1',
    );
    expect(packed.length).toBe(28);
    expect(packed[1].title).toBe('Opening remarks (2)');
    expect(packed[1].dayId).toBe('day-1');
  });

  it('leaves a hidden session out of what it draws from', () => {
    const packed = denseSchedule(
      [
        { id: 'a', title: 'Published', visible: true },
        { id: 'b', title: 'Unpublished', visible: false },
      ],
      'day-1',
    );
    expect(packed.some((session) => session.title.startsWith('Unpublished'))).toBe(false);
  });

  it('runs the day forward in clock order, never past midnight', () => {
    const packed = denseSchedule([], STRESS_DAY.id);
    const times = packed.map((session) => session.startTime);
    expect(times[0]).toBe('08:00');
    expect([...times].sort()).toEqual(times);
  });
});

describe('which page the frame opens', () => {
  it('sends a fixed page to its own route', () => {
    expect(proofPath(page('home'), [])).toBe('/');
    expect(proofPath(page('schedule'), [])).toBe('/schedule');
  });

  it('opens session detail on the first session the frame is showing', () => {
    const sessions = [{ id: 's-1', visible: true }, { id: 's-2', visible: true }];
    expect(proofPath(page('session'), sessions)).toBe('/schedule/s-1');
  });

  it('skips a session the frame would not render either', () => {
    const sessions = [{ id: 's-1', visible: false }, { id: 's-2', visible: true }];
    expect(firstPreviewSession(sessions).id).toBe('s-2');
    expect(proofPath(page('session'), sessions)).toBe('/schedule/s-2');
  });

  it('offers no session page when there is no session to open', () => {
    // Not "this session is not available" in the frame: a preview of a
    // missing record tells an operator nothing about their theme.
    expect(proofPath(page('session'), [])).toBeNull();
  });
});
