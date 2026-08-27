// The public speaker directory renders the `speakers_public` projection
// (spec §4.3, issue #20): the snapshot the bundle ships holds only the
// public-safe fields, and a speaker who is not `approved` has no document
// there at all — so there is no visibility filter for this page to apply,
// and no private field for it to accidentally render.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let speakers;
let pageDoc = null;
vi.mock('../contexts/ContentContext.jsx', () => ({
  // The page shell reads the cmsPages document for its layout and its
  // slot sections (components/SystemPage.jsx); this directory states no
  // sections, and states a layout only where a test sets one.
  useContent: () => ({ speakers, getPage: () => pageDoc, getSectionBlocks: () => [] }),
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

  it('renders the same entries in columns when the page states a grid', () => {
    // `arrangement` changes the shape of the directory, never what it holds
    // (brief §6.1). Every entry is still a hairline-opened row, and no cell
    // becomes a card.
    speakers = [PROJECTED, { ...PROJECTED, id: 'second', slug: 'second', displayName: 'Second' }];
    pageDoc = { id: 'speakers', layout: { arrangement: 'grid' } };
    const { container } = renderSpeakers();
    pageDoc = null;
    expect(container.querySelector('ul').className).toContain('sm:grid-cols-2');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    for (const row of container.querySelectorAll('li')) {
      expect(row.className).toContain('border-t-rule-hairline');
      expect(row.className).not.toContain('rounded');
    }
  });

  it('runs one entry per row by default', () => {
    speakers = [PROJECTED];
    const { container } = renderSpeakers();
    expect(container.querySelector('ul').className).not.toContain('grid-cols');
  });

  it('shows the not-announced empty state when the projection is empty', () => {
    speakers = [];
    renderSpeakers();
    expect(screen.getByText('Speakers have not been announced yet')).toBeInTheDocument();
  });

  it('renders a ruled directory, not a profile-card grid', () => {
    // Design brief §2.1: a rule replaces a card border, and the public
    // directory is a hairline-separated list rather than a grid of boxes.
    speakers = [PROJECTED];
    const { container } = renderSpeakers();
    const entry = container.querySelector('li');
    expect(entry).toHaveClass('border-t-hairline', 'border-t-rule-hairline');
    expect(entry.className).not.toContain('rounded-brand-lg');
    expect(container.querySelector('ul').className).not.toContain('sm:grid-cols-2');
  });

  it('sets the name in the heading face and the affiliation in the data face', () => {
    speakers = [PROJECTED];
    renderSpeakers();
    expect(screen.getByRole('heading', { level: 2, name: 'Rae Okonkwo' })).toHaveClass(
      'font-heading',
    );
    // The credit line is a specimen label (brief §4.5) — a ruled block in
    // Field Guide, the same plain caption line everywhere else — so the
    // data face sits on the field, and the value is the text inside it.
    expect(screen.getByText('Editor, [Demo] Cooperative').closest('p')).toHaveClass(
      'specimen-label__field',
      'font-data',
    );
  });

  it('gates on the speakers feature flag', () => {
    speakers = [PROJECTED];
    features = { speakers: false };
    renderSpeakers();
    expect(screen.getByText('This event doesn’t have a public speaker directory')).toBeInTheDocument();
    features = { speakers: true };
  });
});
