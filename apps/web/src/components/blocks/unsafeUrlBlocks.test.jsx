// Regression test for the CMS url-field XSS gap: cta, link_group, and image
// blocks all render a CMS-authored `url` field into an href/src. Nothing
// server-side validates the scheme (functions/src/cms/content.cjs only
// rejects reserved keys), so each renderer must refuse to render an unsafe
// scheme itself, the same way sanitizeHtml.js already does for richtext
// links.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import CtaBlock from './CtaBlock.jsx';
import LinkGroupBlock from './LinkGroupBlock.jsx';
import ImageBlock from './ImageBlock.jsx';

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
