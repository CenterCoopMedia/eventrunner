// Tag — the one small ruled rectangle the system has (design brief §2.4,
// issue #113).
//
// These assertions guard the shape, not the look: a pill is a rejected
// pattern, so the radius must stay on the theme's own `rounded-brand` step
// and never become `rounded-full`.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import Tag from './Tag.jsx';

describe('Tag', () => {
  it('draws a hairline-ruled rectangle on the theme radius, never a pill', () => {
    render(<Tag>Speaker</Tag>);
    const tag = screen.getByText('Speaker');
    expect(tag).toHaveClass('rounded-brand');
    expect(tag).not.toHaveClass('rounded-full');
    expect(tag).toHaveClass('border-hairline', 'border-rule-hairline', 'bg-surface-alt');
  });

  it('sets the label in the data face at the folio step', () => {
    render(<Tag>Pinned</Tag>);
    const tag = screen.getByText('Pinned');
    expect(tag).toHaveClass('font-data', 'text-folio');
  });

  it('stores the copy in natural case and leaves the small caps to CSS', () => {
    // Interface guidelines, Typography: a screen reader reads the word an
    // editor typed, so the uppercasing is text-transform's job.
    render(<Tag>Back issue</Tag>);
    expect(screen.getByText('Back issue')).toHaveClass('uppercase');
  });

  it('tints the keynote tone without changing the shape', () => {
    render(<Tag tone="keynote">keynote</Tag>);
    const tag = screen.getByText('keynote');
    expect(tag).toHaveClass('border-keynote/40', 'bg-keynote/10');
    expect(tag).toHaveClass('rounded-brand', 'border-hairline');
  });

  it('falls back to the default tone for a tone it does not know', () => {
    render(<Tag tone="nonsense">Workshop</Tag>);
    expect(screen.getByText('Workshop')).toHaveClass('border-rule-hairline', 'bg-surface-alt');
  });
});
