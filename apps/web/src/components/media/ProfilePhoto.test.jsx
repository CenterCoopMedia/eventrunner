// The attendee avatar (issue #24 review follow-up: photoPath was saved and
// projected but never rendered).
//
// Guards pinned here: only a `profile-photos/` object is fetched — the rules
// type-check photoPath but never constrain WHICH object it names — and any
// other value, or a failed load, falls back to the lettered stand-in rather
// than a broken image.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import ProfilePhoto, { initialOf, profilePhotoUrl } from './ProfilePhoto.jsx';
import { BRAND_UTILITY_PREFIX } from '../../test/retiredUtilityNames.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..', '..');
const indexCss = fs.readFileSync(path.resolve(here, '..', '..', 'index.css'), 'utf8');
const avatarTokens = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'design', 'tokens', 'components.json'), 'utf8'),
).avatar;

describe('profilePhotoUrl', () => {
  it('resolves a photo under the owner-bound namespace', () => {
    expect(profilePhotoUrl('profile-photos/u1/photo.png')).toContain(
      encodeURIComponent('profile-photos/u1/photo.png'),
    );
  });

  it('refuses a path pointing anywhere else in the bucket', () => {
    for (const value of [
      'session-materials/s1/slides.pdf',
      'cms-images/a/b.png',
      'demo/sponsors/beacon-community-fund.webp',
      'demo/speakers/../private.webp',
      'demo/speakers/%2e%2e/private.webp',
      '../profile-photos/u1/photo.png',
      'https://evil.example/x.png',
      { path: 'profile-photos/u1/photo.png' },
      null,
    ]) {
      expect(profilePhotoUrl(value)).toBeNull();
    }
  });
});

describe('initialOf', () => {
  it('takes the first character of a name, uppercased', () => {
    expect(initialOf('rae okonkwo')).toBe('R');
    expect(initialOf('  Émile')).toBe('É');
    expect(initialOf('')).toBe('?');
    expect(initialOf(undefined)).toBe('?');
  });
});

describe('ProfilePhoto', () => {
  it('renders a bundled demo speaker portrait under the deployment base', () => {
    vi.stubEnv('BASE_URL', '/eventrunner/');
    try {
      const { container } = render(
        <ProfilePhoto photoPath="demo/speakers/marisol-reyes.webp" displayName="Marisol Reyes" />,
      );
      expect(container.querySelector('img')).toHaveAttribute('src', '/eventrunner/demo/speakers/marisol-reyes.webp');
      expect(container.querySelector('img')).toHaveAttribute('alt', '');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('renders the photo with an empty alt — the name is already text beside it', () => {
    const { container } = render(
      <ProfilePhoto photoPath="profile-photos/u1/photo.png" displayName="Rae Okonkwo" />,
    );
    const image = container.querySelector('img');
    expect(image).toBeInTheDocument();
    expect(image).toHaveAttribute('alt', '');
  });

  it('is the avatar device: a square portrait on the brand radius, never a circle', () => {
    const { container } = render(
      <ProfilePhoto photoPath="profile-photos/u1/photo.png" displayName="Rae Okonkwo" />,
    );
    const image = container.querySelector('img');
    // The radius is the `--avatar-radius` token (the brand radius by
    // default), read by the .avatar rule rather than a utility class.
    expect(image).toHaveClass('avatar');
    expect(image).not.toHaveClass('rounded-full');
  });

  it('keeps the initial stand-in a square portrait too', () => {
    render(<ProfilePhoto photoPath={null} displayName="Rae Okonkwo" />);
    const stub = screen.getByText('R');
    expect(stub).toHaveClass('avatar');
    expect(stub).not.toHaveClass('rounded-full');
  });

  // Issue 247 moved these widgets off the retired brand-* utilities. The
  // avatar device now draws the frame, so the proof is the device's own
  // contract: no retired class on the element, and every default the .avatar
  // rule reads is a tier 2 role token, never a brand-* custom property.
  it('reads the tier 2 role tokens, not the old compatibility names (issue 247)', () => {
    const { container } = render(
      <ProfilePhoto photoPath="profile-photos/u1/photo.png" displayName="Rae Okonkwo" />,
    );
    const image = container.querySelector('img');
    expect(image).toHaveClass('avatar');
    expect(image.className).not.toMatch(BRAND_UTILITY_PREFIX);
  });

  it('reads the tier 2 role tokens on the initial stand-in too', () => {
    render(<ProfilePhoto photoPath={null} displayName="Rae Okonkwo" />);
    const stub = screen.getByText('R');
    expect(stub).toHaveClass('avatar');
    expect(stub.className).not.toMatch(BRAND_UTILITY_PREFIX);
  });

  it('draws through avatar tokens whose defaults are role tokens', () => {
    const rule = indexCss.slice(indexCss.indexOf('  .avatar {'), indexCss.indexOf('  .avatar--sm {'));
    expect(rule).toContain('var(--avatar-ground)');
    expect(rule).not.toMatch(/--brand-/);
    expect(avatarTokens['--avatar-ground']).toBe('rgb(var(--color-surface-alt-rgb))');
    expect(avatarTokens['--avatar-ink']).toBe('rgb(var(--color-text-secondary-rgb))');
    for (const value of Object.values(avatarTokens)) expect(value).not.toMatch(/brand/);
  });

  it('falls back to the initial when there is no photo', () => {
    render(<ProfilePhoto photoPath={null} displayName="Rae Okonkwo" />);
    expect(screen.getByText('R')).toBeInTheDocument();
  });

  it('falls back to the initial when the object fails to load', () => {
    const { container } = render(
      <ProfilePhoto photoPath="profile-photos/u1/gone.png" displayName="Rae Okonkwo" />,
    );
    fireEvent.error(container.querySelector('img'));
    expect(screen.getByText('R')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });
});
