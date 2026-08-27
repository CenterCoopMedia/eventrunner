// Regression test for the sponsor-link XSS gap: Sponsors.jsx rendered
// organizationsData's raw `url` field straight into an href, so a
// javascript: URL in a sponsor record would execute on click. It must go
// through the same isSafeHref allowlist the block renderers use.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const UNSAFE_URL = 'javascript:alert(1)';
const SAFE_URL = 'https://example.org';

let organizationsData;
vi.mock('../contexts/ContentContext.jsx', () => ({
  // The page shell reads the cmsPages document for its layout and its
  // slot sections (components/SystemPage.jsx); this directory has neither.
  useContent: () => ({ organizationsData, getPage: () => null, getSectionBlocks: () => [] }),
}));
vi.mock('../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ features: { sponsors: true } }),
}));

import Sponsors from './Sponsors.jsx';

function renderSponsors() {
  return render(
    <MemoryRouter>
      <Sponsors />
    </MemoryRouter>,
  );
}

describe('Sponsors', () => {
  it('renders no link for a sponsor with an unsafe (javascript:) url, but still shows its name', () => {
    organizationsData = [
      {
        id: 'org-1',
        name: 'Unsafe Org',
        url: UNSAFE_URL,
        tier: 'Gold',
        description: 'desc',
        visible: true,
      },
    ];
    renderSponsors();
    expect(screen.getByText('Unsafe Org')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Unsafe Org' })).toBeNull();
  });

  it('renders a link for a sponsor with a safe (https:) url', () => {
    organizationsData = [
      {
        id: 'org-2',
        name: 'Safe Org',
        url: SAFE_URL,
        tier: 'Gold',
        description: 'desc',
        visible: true,
      },
    ];
    renderSponsors();
    expect(screen.getByRole('link', { name: 'Safe Org' })).toHaveAttribute('href', SAFE_URL);
  });
});
