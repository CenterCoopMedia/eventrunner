// The nameplate device the `masthead` header draws (design brief §2.1).
//
// Two things are load-bearing here and both are checked below: the block is
// type and rules only (no banner, no background image), and its dates and
// edition line sit INSIDE the rule-bounded block, which is the one place
// brief §2.4 allows metadata near a title. The name is not a heading — the
// site identity repeats on every page, so each page keeps its own <h1>.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Nameplate, { buildNameplate } from './Nameplate.jsx';

const here = path.dirname(fileURLToPath(import.meta.url));
const indexCss = fs.readFileSync(path.resolve(here, '..', '..', 'index.css'), 'utf8');

function renderPlate(props) {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Nameplate {...props} />
    </MemoryRouter>,
  );
}

describe('buildNameplate', () => {
  const eventConfig = {
    name: '[Fixture] Harbour Summit',
    shortName: 'FX-SUMMIT',
    timezone: 'America/New_York',
    days: [{ date: '2026-10-14' }, { date: '2026-10-16' }],
    venue: { name: '[Fixture] Hall', city: 'Fixtureville', region: 'FX' },
  };

  it('builds the three lines from config/event', () => {
    expect(buildNameplate(eventConfig)).toEqual({
      name: '[Fixture] Harbour Summit',
      dates: 'October 14–16, 2026',
      edition: 'Fixtureville, FX',
    });
  });

  it('prefers the short name for the compact treatment', () => {
    expect(buildNameplate(eventConfig, { compact: true }).name).toBe('FX-SUMMIT');
  });

  it('falls back to the venue name when the venue has no city', () => {
    const venue = { name: '[Fixture] Hall' };
    expect(buildNameplate({ ...eventConfig, venue }).edition).toBe('[Fixture] Hall');
  });

  it('survives a malformed runtime config without throwing', () => {
    // config/event is a fail-soft overlay (spec §2.4): a live write can
    // deliver a partial or wrongly typed document, and the shell that wraps
    // every route must still render.
    expect(buildNameplate({ name: 42, venue: 'not an object', days: null })).toEqual({
      name: '',
      dates: null,
      edition: null,
    });
    expect(buildNameplate(undefined).name).toBe('');
  });
});

describe('Nameplate', () => {
  it('renders the name, the dates, and the edition line inside one block', () => {
    const { container } = renderPlate({
      name: '[Fixture] Harbour Summit',
      dates: 'October 14–16, 2026',
      edition: 'Fixtureville, FX',
    });
    const block = container.querySelector('.nameplate');
    expect(block).not.toBeNull();
    expect(block.textContent).toContain('[Fixture] Harbour Summit');
    expect(block.textContent).toContain('October 14–16, 2026');
    expect(block.textContent).toContain('Fixtureville, FX');
  });

  it('sets the dateline in the mono face so the figures stay a column', () => {
    const { container } = renderPlate({ name: 'X', dates: 'October 14–16, 2026' });
    expect(container.querySelector('.font-mono').textContent).toBe('October 14–16, 2026');
  });

  it('is type and rules only — no image, no background', () => {
    const { container } = renderPlate({ name: 'X', dates: 'D', edition: 'E' });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[style*="background-image"]')).toBeNull();
  });

  it('is not a heading on a running header, so a page keeps one h1', () => {
    renderPlate({ name: '[Fixture] Harbour Summit', dates: 'D' });
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('can still carry a heading where a caller asks for one', () => {
    // The shell never asks: the header identity is a running site name. The
    // prop stays because a page whose subject IS the nameplate can use it.
    renderPlate({ name: '[Fixture] Harbour Summit', nameAs: 'h1', nameId: 'site-title' });
    const heading = screen.getByRole('heading', {
      level: 1,
      name: '[Fixture] Harbour Summit',
    });
    expect(heading).toHaveClass('nameplate__name');
    expect(heading).toHaveAttribute('id', 'site-title');
  });

  it('links the name home when a destination is given', () => {
    renderPlate({ name: '[Fixture] Harbour Summit', to: '/' });
    expect(
      screen.getByRole('link', { name: '[Fixture] Harbour Summit' }),
    ).toHaveAttribute('href', '/');
  });

  it('steps the name down for the compact treatment and keeps both rules', () => {
    const { container } = renderPlate({ name: 'X', variant: 'compact' });
    expect(container.querySelector('.nameplate')).toHaveClass('nameplate--compact');
  });

  it('renders the block with no dateline at all rather than an empty line', () => {
    const { container } = renderPlate({ name: 'X' });
    expect(container.querySelectorAll('.nameplate p')).toHaveLength(1);
  });

  it('holds the mark slot for the motif, and yields it to a client mark', () => {
    // Brief §3.8: the nameplate-mark slot. A client's own branding mark
    // wins — a paper prints its own flag, not the printer's ornament — and
    // the slot renders nothing at all under the `none` set (index.css).
    const { container, rerender } = renderPlate({ name: 'X' });
    expect(container.querySelector('[data-motif-slot="nameplate-mark"]')).not.toBeNull();

    rerender(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Nameplate name="X" mark={<img src="/branding/mark.svg" alt="" />} />
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-motif-slot="nameplate-mark"]')).toBeNull();
    expect(container.querySelector('img')).not.toBeNull();
  });

  it('closes the full treatment with the divider slot, and the running head without it', () => {
    // Atlas moment 1: a schematic line diagram closes the title block. A
    // running header is not a title block, so it carries no divider.
    const { container } = renderPlate({ name: 'X' });
    expect(container.querySelector('[data-motif-slot="divider"]')).not.toBeNull();

    const compact = renderPlate({ name: 'X', variant: 'compact' });
    expect(compact.container.querySelector('[data-motif-slot="divider"]')).toBeNull();
  });

  it('carries two coordinate marks, decorative and drawn at a token width', () => {
    const { container } = renderPlate({ name: 'X' });
    const marks = container.querySelectorAll('.nameplate__coordinate');
    expect(marks).toHaveLength(2);
    for (const mark of marks) expect(mark).toHaveAttribute('aria-hidden', 'true');
  });

  it('lays the lockup out the way the Header style sets the block', () => {
    // A start-aligned masthead puts the name at one end of the measure and
    // the dateline at the other, which is space-between. A CENTRED one wants
    // neither end: with space-between, a dateline that wrapped under a long
    // centred name landed at the start of the row, reading as a stray line.
    // jsdom does not lay flex out, so the rule itself is what is checked.
    expect(indexCss).toMatch(
      /\.nameplate__lockup \{[^}]*justify-content: space-between;/,
    );
    expect(indexCss).toMatch(
      /@container style\(--nameplate-align: center\) \{\s*\.nameplate__lockup \{\s*justify-content: center;/,
    );
  });
});
