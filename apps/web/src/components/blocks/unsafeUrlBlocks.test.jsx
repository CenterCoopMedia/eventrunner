// Regression test for the CMS url-field XSS gap: cta, link_group, and image
// blocks all render a CMS-authored `url` field into an href/src. Nothing
// server-side validates the scheme (functions/src/cms/content.cjs only
// rejects reserved keys), so each renderer must refuse to render an unsafe
// scheme itself, the same way sanitizeHtml.js already does for richtext
// links.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CtaBlock from './CtaBlock.jsx';
import LinkGroupBlock from './LinkGroupBlock.jsx';
import ImageBlock from './ImageBlock.jsx';

const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true };

const UNSAFE_URLS = ['javascript:alert(1)', ' JAVASCRIPT:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)'];

describe('CtaBlock', () => {
  it('renders nothing for an unsafe url', () => {
    for (const url of UNSAFE_URLS) {
      const { container, unmount } = render(<CtaBlock block={{ url, label: 'Go' }} />);
      expect(container.innerHTML).toBe('');
      unmount();
    }
  });

  it('renders a link for a safe url', () => {
    const { getByRole } = render(<CtaBlock block={{ url: 'https://example.org', label: 'Go' }} />);
    expect(getByRole('link')).toHaveAttribute('href', 'https://example.org');
  });

  it('renders an external link with rel="noreferrer" even when not marked external', () => {
    const { getByRole } = render(<CtaBlock block={{ url: 'https://example.org', label: 'Go' }} />);
    const link = getByRole('link');
    expect(link).toHaveAttribute('rel', 'noreferrer');
    expect(link).not.toHaveAttribute('target');
  });

  it('opens a new tab only when the block is marked external', () => {
    const { getByRole } = render(
      <CtaBlock block={{ url: 'https://example.org', label: 'Go', external: true }} />,
    );
    const link = getByRole('link');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('renders an in-app route through the router Link, not a page-reloading anchor', () => {
    // The regression this covers: the public click-through demo runs
    // under HashRouter (main.jsx), where a raw href="/schedule" 404s
    // instead of navigating within the app.
    const { getByRole } = render(
      <MemoryRouter future={ROUTER_FUTURE}>
        <CtaBlock block={{ url: '/schedule', label: 'See the schedule' }} />
      </MemoryRouter>,
    );
    const link = getByRole('link');
    expect(link).toHaveAttribute('href', '/schedule');
    // A router Link, unlike a plain anchor pointed at the same path, never
    // sets target or rel — there is no new tab and no window.opener to sever.
    expect(link).not.toHaveAttribute('target');
    expect(link).not.toHaveAttribute('rel');
  });
});

describe('LinkGroupBlock', () => {
  it('renders nothing for an unsafe url', () => {
    for (const url of UNSAFE_URLS) {
      const { container, unmount } = render(
        <ul>
          <LinkGroupBlock block={{ url, label: 'Go' }} />
        </ul>,
      );
      expect(container.querySelector('a')).toBeNull();
      unmount();
    }
  });

  it('renders a link for a safe url', () => {
    const { getByRole } = render(
      <ul>
        <LinkGroupBlock block={{ url: 'mailto:hi@example.org', label: 'Mail us' }} />
      </ul>,
    );
    expect(getByRole('link')).toHaveAttribute('href', 'mailto:hi@example.org');
  });

  it('marks an external anchor rel="noreferrer"', () => {
    const { getByRole } = render(
      <ul>
        <LinkGroupBlock block={{ url: 'https://example.org/photos', label: 'Photos' }} />
      </ul>,
    );
    expect(getByRole('link')).toHaveAttribute('rel', 'noreferrer');
  });

  it('renders an in-app route through the router Link, not a page-reloading anchor', () => {
    const { getByRole } = render(
      <MemoryRouter future={ROUTER_FUTURE}>
        <ul>
          <LinkGroupBlock block={{ url: '/schedule', label: 'Browse the schedule' }} />
        </ul>
      </MemoryRouter>,
    );
    const link = getByRole('link');
    expect(link).toHaveAttribute('href', '/schedule');
    expect(link).not.toHaveAttribute('rel');
  });
});

describe('ImageBlock', () => {
  it('renders nothing for an unsafe url', () => {
    for (const url of UNSAFE_URLS) {
      const { container, unmount } = render(<ImageBlock block={{ url, alt: 'x' }} />);
      expect(container.innerHTML).toBe('');
      unmount();
    }
  });

  it('renders an image for a safe url', () => {
    const { getByRole } = render(<ImageBlock block={{ url: 'https://example.org/i.png', alt: 'x' }} />);
    expect(getByRole('img')).toHaveAttribute('src', 'https://example.org/i.png');
  });
});
