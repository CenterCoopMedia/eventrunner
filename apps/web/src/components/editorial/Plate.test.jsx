// Plate, the plate number, and the specimen label — the two Field Guide
// devices (design brief §4.5; visual story, Field Guide).
//
// The point of every test here is that neither device asks which theme is
// active. Both are drawn by tier-3 tokens that sit at zero in the five
// presets that are not plate books, so the SAME markup renders the plain
// block those presets already had and the framed plate Field Guide asks
// for. What the tests can check in jsdom is the markup and the contract;
// the token values themselves are checked against the stylesheet.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import Plate, { PlateNumber, romanNumeral } from './Plate.jsx';
import SpecimenLabel from './SpecimenLabel.jsx';

const here = path.dirname(fileURLToPath(import.meta.url));
const indexCss = fs.readFileSync(path.resolve(here, '..', '..', 'index.css'), 'utf8');
const themeCss = fs.readFileSync(
  path.resolve(here, '..', '..', 'generated', 'theme.css'),
  'utf8',
);

describe('Plate', () => {
  it('wraps its children and adds no chrome of its own', () => {
    const { container } = render(
      <Plate className="mt-lg">
        <p>Nothing collected here yet.</p>
      </Plate>,
    );
    expect(container.firstChild).toHaveClass('plate', 'mt-lg');
    expect(screen.getByText('Nothing collected here yet.')).toBeInTheDocument();
  });

  it('draws a DOUBLE hairline frame, and nothing at all at zero width', () => {
    // Border plus outline at one token width: the doubling needs no second
    // element, and an outline takes no space, so a preset that leaves the
    // width at zero keeps the block it had.
    expect(indexCss).toMatch(
      /\.plate \{[^}]*border: var\(--plate-frame-width\) solid rgb\(var\(--plate-frame-rgb\)\);/,
    );
    expect(indexCss).toMatch(
      /\.plate \{[^}]*outline: var\(--plate-frame-width\) solid rgb\(var\(--plate-frame-rgb\)\);/,
    );
    expect(themeCss).toContain('--plate-frame-width: 0;');
    expect(themeCss).toContain('--plate-pad: 0;');
  });
});

describe('romanNumeral', () => {
  it('counts real positions and refuses anything that is not one', () => {
    expect(romanNumeral(1)).toBe('I');
    expect(romanNumeral(3)).toBe('III');
    expect(romanNumeral(4)).toBe('IV');
    expect(romanNumeral(9)).toBe('IX');
    expect(romanNumeral(14)).toBe('XIV');
    expect(romanNumeral(40)).toBe('XL');
    expect(romanNumeral(0)).toBeNull();
    expect(romanNumeral(-2)).toBeNull();
    expect(romanNumeral(1.5)).toBeNull();
    expect(romanNumeral('3')).toBeNull();
  });
});

describe('PlateNumber', () => {
  it('sets the day position as a plate number, with its separator', () => {
    const { container } = render(<PlateNumber position={3} />);
    expect(container.firstChild).toHaveClass('plate-number');
    expect(container.textContent).toBe('Plate III · ');
  });

  it('renders nothing where there is no real position', () => {
    const { container } = render(<PlateNumber position={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('is never a decorative number: no zero padding, and hidden where unset', () => {
    // Brief §2.4 rejects `01 / 02 / 03`. This number counts days, and in a
    // preset that is not a plate book it leaves the document entirely
    // rather than reading a number the page never states.
    render(<PlateNumber position={2} />);
    expect(screen.queryByText(/0\d/)).toBeNull();
    expect(indexCss).toMatch(/\.plate-number \{\s*display: var\(--plate-number-display\);\s*\}/);
    expect(themeCss).toContain('--plate-number-display: none;');
  });
});

describe('SpecimenLabel', () => {
  it('states each field as a key and a value in the data face', () => {
    const { container } = render(
      <SpecimenLabel fields={[{ key: 'Place', value: 'Main hall' }]} />,
    );
    expect(container.firstChild).toHaveClass('specimen-label');
    expect(container.querySelector('.specimen-label__key').textContent).toBe('Place');
    expect(screen.getByText('Main hall')).toHaveClass('specimen-label__value');
    expect(container.querySelector('.specimen-label__field')).toHaveClass('font-data');
  });

  it('stores the key in natural case and leaves the small caps to CSS', () => {
    render(<SpecimenLabel fields={[{ key: 'Affiliation', value: 'Editor' }]} />);
    expect(screen.getByText('Affiliation')).toBeInTheDocument();
  });

  it('renders nothing when every field is empty, rather than an empty block', () => {
    const { container } = render(
      <SpecimenLabel fields={[{ key: 'Place', value: '' }, null, { key: 'X', value: null }]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('is a ruled block, never a chip: no radius, no fill, no border box', () => {
    // Brief §4.5: "never a chip and never gets a pill radius".
    const { container } = render(
      <SpecimenLabel fields={[{ key: 'Place', value: 'Main hall' }]} />,
    );
    expect(container.innerHTML).not.toContain('rounded');
    expect(container.innerHTML).not.toContain('bg-');
    expect(indexCss).toMatch(
      /\.specimen-label \{[^}]*border-block: var\(--specimen-label-rule-width\)/,
    );
    expect(themeCss).toContain('--specimen-label-rule-width: 0;');
    expect(themeCss).toContain('--specimen-label-key-display: none;');
  });

  it('carries the pencil line only where a page asks for it', () => {
    // Field Guide allows at most one per page, and it is off until a client
    // turns marginalia on (--marginalia-display).
    const plain = render(<SpecimenLabel fields={[{ key: 'Place', value: 'Hall' }]} />);
    expect(plain.container.querySelector('.marginalia')).toBeNull();

    const noted = render(
      <SpecimenLabel pencil fields={[{ key: 'Place', value: 'Hall' }]} />,
    );
    expect(noted.container.querySelector('[data-marginalia-mark="pencil"]')).not.toBeNull();
  });
});
