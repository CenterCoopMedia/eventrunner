import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RichTextBlock from './RichTextBlock.jsx';

describe('RichTextBlock', () => {
  it('omits copied embed source saved as a heading', () => {
    const embed = '&lt;iframe src="https://example.org/map"&gt;&lt;/iframe&gt;';
    const { container } = render(<RichTextBlock block={{ value: `
      <h2><strong>${embed}</strong></h2>
      <h3>Venue &amp; travel</h3>
      <h4><code>${embed}</code></h4>
      <h4>&lt;div&gt;${embed}&lt;/div&gt;</h4>
      <h4>${embed} is source code.</h4>
      <h4>&lt;iframe&gt; Embeds 101</h4>
      <p>Take the south entrance.</p>
    ` }} />);

    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Venue & travel' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent)).toEqual([
      '<iframe src="https://example.org/map"></iframe>',
      '<iframe src="https://example.org/map"></iframe> is source code.',
      '<iframe> Embeds 101',
    ]);
    expect(screen.getByText('Take the south entrance.')).toBeInTheDocument();
    expect(container.querySelector('iframe')).toBeNull();
  });
});
