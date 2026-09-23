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

/** The <dt> that carries a term. A dt takes no accessible name from its text in jsdom. */
const termNamed = (term) =>
  [...document.querySelectorAll('dt')].find((node) => node.textContent === term) ?? null;

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

/** A fact block (#234): a term, a description, and one optional line. */
const fact = (field, label, value, note) => ({
  section: 'info',
  field,
  blockType: 'fact',
  label,
  value,
  ...(note ? { note } : {}),
});

const WHEN_WHERE_WHO = [
  stat('when', 'When', '3 days'),
  line('when_note', 'Doors open at 09:00.'),
  stat('where', 'Where', '1 venue'),
  stat('who', 'Who', '420 people'),
  line('who_note', 'Workshop places go to registered participants first.'),
];

// The shape the seed writes now: three facts, no evidence fields, and one
// line under the second.
const THREE_FACTS = [
  fact('when', 'When', '14–16 October 2026', 'Doors open at 09:00.'),
  fact('where', 'Where', 'Harborlight Hall', '12 Quay Street, Portsmouth'),
  line('where_transit', 'Ten minutes on foot from the station.'),
  fact('who', 'Who', 'Local newsroom staff and their partners'),
];

describe('groupIntoCards', () => {
  it('opens a card on each stat and hangs the lines after it on that card', () => {
    const cards = groupIntoCards(WHEN_WHERE_WHO);
    expect(cards.map((card) => [card.lead.field, card.lines.map((l) => l.field)])).toEqual([
      ['when', ['when_note']],
      ['where', []],
      ['who', ['who_note']],
    ]);
  });

  it('opens a card on a fact block too, with no evidence fields asked for (issue 234)', () => {
    const cards = groupIntoCards(THREE_FACTS);
    expect(cards.map((card) => [card.lead.field, card.lines.map((l) => l.field)])).toEqual([
      ['when', []],
      ['where', ['where_transit']],
      ['who', []],
    ]);
  });

  it('drops a fact missing either half rather than counting it', () => {
    const cards = groupIntoCards([
      fact('where', 'Where', '  '),
      line('where_transit', 'Ten minutes on foot from the station.'),
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0].lead).toBeNull();
    expect(cards[0].lines.map((l) => l.field)).toEqual(['where_transit']);
  });

  it('keeps lines written before any fact rather than dropping them', () => {
    const cards = groupIntoCards([line('note', 'A line on its own.'), stat('when', 'When', '3 days')]);
    expect(cards).toHaveLength(2);
    expect(cards[0].lead).toBeNull();
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
    expect(cards[1].lead).toBeNull();
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
  it('renders a fact through the definition list device, as a term and a description', () => {
    const { container } = render(<InfoCards cards={groupIntoCards(THREE_FACTS)} />);
    const lists = [...container.querySelectorAll('dl.definition-list')];
    expect(lists).toHaveLength(3);
    expect(termNamed('Where')).toBeInTheDocument();
    expect(screen.getByText('Harborlight Hall').tagName).toBe('DD');
    expect(screen.getByText('12 Quay Street, Portsmouth').tagName).toBe('DD');
    // The line under the fact is that card's own.
    expect(within(lists[1].parentElement).getByText('Ten minutes on foot from the station.')).toBeInTheDocument();
    // No evidence fields are drawn, because a fact carries none.
    expect(container.querySelectorAll('[data-numeric]')).toHaveLength(0);
  });

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

  it('gives one card the measure rather than a third of it', () => {
    // A single card in a three-column grid drew at a third of the measure,
    // which reads as a cramped box rather than as one fact stated plainly.
    const { container } = render(
      <InfoCards cards={groupIntoCards([WHEN_WHERE_WHO[0]])} />,
    );
    const group = container.firstChild;
    expect(group.className).toContain('measure');
    expect(group.className).not.toContain('grid-cols');
  });

  it('splits the measure between two cards', () => {
    const { container } = render(
      // Two facts and the line under the first: two cards, not two blocks.
      <InfoCards cards={groupIntoCards(WHEN_WHERE_WHO.slice(0, 3))} />,
    );
    const group = container.firstChild;
    expect(group.className).toContain('measure');
    expect(group.className).toContain('sm:grid-cols-2');
    expect(group.className).not.toContain('lg:grid-cols-3');
  });

  it('runs down one column inside a cell of the summary row, whatever the count', () => {
    const { container } = render(
      <InfoCards cards={groupIntoCards(WHEN_WHERE_WHO)} columns="single" />,
    );
    const group = container.firstChild;
    expect(group.className).toContain('grid');
    expect(group.className).not.toContain('grid-cols');
    // The cell is already a column of the stage, so the group takes it.
    expect(group.className).not.toContain('measure');
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
