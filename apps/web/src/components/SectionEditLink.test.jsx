// The public edit link (issue #198): drawn for a signed-in admin only, and it
// names the one editor that holds the section's blocks.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthContext from '../contexts/AuthContext.jsx';
import SectionEditLink, { sectionEditPath } from './SectionEditLink.jsx';

function renderLink(auth, props = {}) {
  const link = <SectionEditLink pageId="home" sectionId="details" label="Details" {...props} />;
  return render(
    <MemoryRouter>
      {auth === undefined ? link : <AuthContext.Provider value={auth}>{link}</AuthContext.Provider>}
    </MemoryRouter>,
  );
}

describe('SectionEditLink', () => {
  it('draws nothing with no auth provider, so a bare component render is not an admin', () => {
    const { container } = renderLink(undefined);
    expect(container).toBeEmptyDOMElement();
  });

  it('draws nothing while the admin probe is unknown, and nothing for a non-admin', () => {
    for (const adminStatus of ['unknown', 'denied']) {
      const { container, unmount } = renderLink({ adminStatus });
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it('opens the section’s blocks in the admin for a signed-in admin, named for the section', () => {
    renderLink({ adminStatus: 'admin' });
    const link = screen.getByRole('link', { name: 'Edit section: Details' });
    expect(link).toHaveAttribute('href', '/admin/content/home/details');
    // The visible words stay short, and the name starts with them.
    expect(link).toHaveTextContent(/^Edit section$/);
    // It never reaches paper.
    expect(link).toHaveClass('no-print');
  });

  it('shows for both admin tiers: the probe answer is the only thing it reads', () => {
    for (const adminTier of ['operator', 'staff']) {
      const { unmount } = renderLink({ adminStatus: 'admin', adminTier });
      expect(screen.getByRole('link', { name: 'Edit section: Details' })).toBeInTheDocument();
      unmount();
    }
  });

  it('encodes a section id that carries a space or a slash', () => {
    expect(sectionEditPath('home', 'a b/c')).toBe('/admin/content/home/a%20b%2Fc');
    renderLink({ adminStatus: 'admin' }, { sectionId: 'a b/c', label: 'Odd one' });
    expect(screen.getByRole('link', { name: 'Edit section: Odd one' })).toHaveAttribute(
      'href',
      '/admin/content/home/a%20b%2Fc',
    );
  });
});
