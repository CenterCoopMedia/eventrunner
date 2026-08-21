// The attendee avatar (issue #24 review follow-up: photoPath was saved and
// projected but never rendered).
//
// Guards pinned here: only a `profile-photos/` object is fetched — the rules
// type-check photoPath but never constrain WHICH object it names — and any
// other value, or a failed load, falls back to the lettered stand-in rather
// than a broken image.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import ProfilePhoto, { initialOf, profilePhotoUrl } from './ProfilePhoto.jsx';

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
  it('renders the photo with an empty alt — the name is already text beside it', () => {
    const { container } = render(
      <ProfilePhoto photoPath="profile-photos/u1/photo.png" displayName="Rae Okonkwo" />,
    );
    const image = container.querySelector('img');
    expect(image).toBeInTheDocument();
    expect(image).toHaveAttribute('alt', '');
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
