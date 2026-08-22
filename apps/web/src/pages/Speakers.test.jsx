// The public speaker directory renders the `speakers_public` projection
// (spec §4.3, issue #20): the snapshot the bundle ships holds only the
// public-safe fields, and a speaker who is not `approved` has no document
// there at all — so there is no visibility filter for this page to apply,
// and no private field for it to accidentally render.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let speakers;
vi.mock('../contexts/ContentContext.jsx', () => ({
  useContent: () => ({ speakers }),
}));
let features = { speakers: true };
vi.mock('../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ features }),
}));

import Speakers from './Speakers.jsx';

function renderSpeakers() {
  return render(
    <MemoryRouter>
      <Speakers />
    </MemoryRouter>,
  );
}

const PROJECTED = {
  id: 'rae-okonkwo',
  firstName: 'Rae',
  lastName: 'Okonkwo',
  displayName: 'Rae Okonkwo',
  slug: 'rae-okonkwo',
  bio: 'Community reporter.',
  headshotPath: 'speakers/rae.jpg',
  organization: '[Demo] Cooperative',
  jobTitle: 'Editor',
  socialHandles: {},
};

describe('Speakers', () => {
  it('renders the projected display name, affiliation, and bio', () => {
    speakers = [PROJECTED];
    renderSpeakers();
    expect(screen.getByRole('heading', { level: 2, name: 'Rae Okonkwo' })).toBeInTheDocument();
    expect(screen.getByText('Editor, [Demo] Cooperative')).toBeInTheDocument();
    expect(screen.getByText('Community reporter.')).toBeInTheDocument();
  });

  it('renders a speaker with no affiliation or bio without empty lines', () => {
    speakers = [{ ...PROJECTED, organization: '', jobTitle: '', bio: '' }];
    const { container } = renderSpeakers();
    expect(screen.getByRole('heading', { level: 2, name: 'Rae Okonkwo' })).toBeInTheDocument();
    expect(container.querySelectorAll('li p')).toHaveLength(0);
  });

  it('shows the not-announced empty state when the projection is empty', () => {
    speakers = [];
    renderSpeakers();
    expect(screen.getByText('Speakers have not been announced yet')).toBeInTheDocument();
  });

  it('gates on the speakers feature flag', () => {
    speakers = [PROJECTED];
    features = { speakers: false };
    renderSpeakers();
    expect(screen.getByText('This event doesn’t have a public speaker directory')).toBeInTheDocument();
    features = { speakers: true };
  });
});
