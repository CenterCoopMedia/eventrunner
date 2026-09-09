// InfoCards: the home page's key facts, as one group of cards (M7 issue 9).
//
// Two things are worth holding here. The GROUPING, because it is positional
// and an editor reordering blocks in the admin has to be able to predict
// it. And the TREATMENT: figures in the mono face with tabular figures, and
// nothing that counts up — an animated counter is ambient motion in the one
// place a reader came to read a fact, which the interface guidelines
// reject.
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import InfoCards, { groupIntoCards } from './InfoCards.jsx';

/** A stat block in the six-part shape every stat is written in today. */
const stat = (field, label, value) => ({
  section: 'info',
  field,
  blockType: 'stat',
  value,
  label,
  takeaway: `${label} in words`,
  description: `What ${label} counts.`,
  source: 'A source line.',
  alt: `${label}, for a screen reader.`,
});

const line = (field, text) => ({ section: 'info', field, blockType: 'list_item', text });

const WHEN_WHERE_WHO = [
  stat('when', 'When', '3 days'),
  line('when_note', 'Doors open at 09:00.'),
  stat('where', 'Where', '1 venue'),
  stat('who', 'Who', '420 people'),
  line('who_note', 'Workshop places go to registered participants first.'),
];

describe('groupIntoCards', () => {
  it('opens a card on each stat and hangs the lines after it on that card', () => {
    const cards = groupIntoCards(WHEN_WHERE_WHO);
    expect(cards.map((card) => [card.stat.field, card.lines.map((l) => l.field)])).toEqual([
      ['when', ['when_note']],
      ['where', []],
      ['who', ['who_note']],
    ]);
  });

  it('keeps lines written before any fact rather than dropping them', () => {
    const cards = groupIntoCards([line('note', 'A line on its own.'), stat('when', 'When', '3 days')]);
    expect(cards).toHaveLength(2);
    expect(cards[0].stat).toBeNull();
    expect(cards[0].lines.map((l) => l.field)).toEqual(['note']);
  });

  it('drops a line whose text is blank rather than counting it', () => {
    // Only a stat's fields are checked when content is written, so a
    // published line can carry an empty text. ListItemBlock draws nothing
    // for it, so the grouping must not count it either.
    const cards = groupIntoCards([
      line('note', '   '),
      line('real', 'A line with something in it.'),
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0].lines.map((l) => l.field)).toEqual(['real']);
  });

  it('opens no card for a section whose lines are all blank', () => {
    // A card here would reach the page as a heading over nothing: Home
    // opens the section on this count.
    expect(groupIntoCards([line('note', ''), line('other', '  ')])).toEqual([]);
  });

  it('keeps the lines under a fact that draws nothing, and prints no fact', () => {
    // The line was written under this fact, so it stays under it rather
    // than joining the fact above; the card just opens without a figure.
    const cards = groupIntoCards([
      stat('when', 'When', '3 days'),
      { section: 'info', field: 'where', blockType: 'stat', value: '', label: '' },
      line('where_note', 'The hall is on the ground floor.'),
    ]);
    expect(cards).toHaveLength(2);
    expect(cards[1].stat).toBeNull();
    expect(cards[1].lines.map((l) => l.field)).toEqual(['where_note']);
  });

  it('ignores a block type this arrangement does not draw', () => {
    const cards = groupIntoCards([
      { section: 'info', field: 'x', blockType: 'richtext', value: '<p>Not here.</p>' },
    ]);
    expect(cards).toEqual([]);
  });
});

describe('InfoCards', () => {
  it('renders three entries as one group, each fact with its own lines', () => {
    render(<InfoCards cards={groupIntoCards(WHEN_WHERE_WHO)} />);
    // One description list per card, so each fact keeps its own term and
    // definition wherever the group wraps.
    const lists = screen.getAllByRole('term');
    expect(lists).toHaveLength(3);
    expect(screen.getByText('When in words')).toBeInTheDocument();
    expect(screen.getByText('Where in words')).toBeInTheDocument();
    expect(screen.getByText('Who in words')).toBeInTheDocument();
    const items = screen.getAllByRole('listitem').map((node) => node.textContent);
    expect(items).toContain('Doors open at 09:00.');
    expect(items).toContain('Workshop places go to registered participants first.');
  });

  it('sets the figures in the mono face with tabular figures, and never animates them', () => {
    const { container } = render(<InfoCards cards={groupIntoCards(WHEN_WHERE_WHO)} />);
    const figures = [...container.querySelectorAll('[data-numeric]')];
    expect(figures).toHaveLength(3);
    for (const figure of figures) {
      expect(figure.className).toContain('font-mono');
    }
    // Printed once, as text. Nothing counts up, nothing transitions.
    expect(container.querySelectorAll('[class*="animate-"], [class*="transition"]')).toHaveLength(0);
  });

  it('stacks to one column on a narrow screen and widens to a row', () => {
    const { container } = render(<InfoCards cards={groupIntoCards(WHEN_WHERE_WHO)} />);
    // The base state is the plain stacked list; the columns are the wide
    // exception, never the other way round.
    const group = container.firstChild;
    expect(group.className).toContain('grid');
    expect(group.className).not.toContain('grid-cols-3 ');
    expect(group.className).toContain('sm:grid-cols-2');
    expect(group.className).toContain('lg:grid-cols-3');
  });

  it('renders only the lines that say something', () => {
    const { container } = render(
      <InfoCards
        cards={groupIntoCards([
          stat('when', 'When', '3 days'),
          line('blank', ''),
          line('real', 'Doors open at 09:00.'),
        ])}
      />,
    );
    const items = [...container.querySelectorAll('li')].map((node) => node.textContent);
    expect(items).toEqual(['Doors open at 09:00.']);
  });

  it('renders nothing at all for an empty section', () => {
    const { container } = render(<InfoCards cards={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('draws a lines-only card on its own rule', () => {
    const { container } = render(
      <InfoCards cards={groupIntoCards([line('note', 'A line on its own.')])} />,
    );
    const list = container.querySelector('ul');
    expect(list.className).toContain('border-t-hairline');
    expect(within(list).getByText('A line on its own.')).toBeInTheDocument();
  });
});
