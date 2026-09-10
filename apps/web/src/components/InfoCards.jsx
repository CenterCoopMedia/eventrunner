// The home page's key facts, as one group of cards (M7 issue 9): when the
// event runs, where it happens, and who it is for.
//
// NO NEW BLOCK TYPE. The two types that already say these things say them
// here: a `stat` carries one fact and its caption, a `list_item` carries a
// plain line. What this file adds is the ARRANGEMENT — which blocks belong
// to which card, and how the group sits on the page.
//
// A STAT OPENS A CARD; THE LIST ITEMS AFTER IT ARE THAT CARD'S LINES. The
// grouping is positional, which is the idiom the block renderer already
// uses (SectionBlocks batches runs of one type, LinkGroups reads the
// group's own name), and it is the one an editor can see: the blocks are in
// the order they are listed in, so moving a line under a different fact is
// a reorder rather than a field to fill in. List items written before any
// stat are a card of their own, so a section holding nothing but lines
// still renders rather than dropping them.
//
// A BLOCK THAT DRAWS NOTHING IS NOT COUNTED. The grouping asks the same
// question the block's own renderer asks — has this stat a figure and a
// caption, has this line any text — because Home opens the section and
// writes its heading on the number of cards here. Counting a block the
// renderer then drops would leave an empty card under a heading.
//
// THE BLOCKS RENDER THROUGH THEIR OWN RENDERERS. StatBlock draws the fact
// and ListItemBlock draws the line, exactly as they do everywhere else, so
// a change to how a stat reads reaches this group too and nothing here can
// drift away from the rest of the site. StatBlock also already puts the
// figure in the mono face with tabular figures for the six-part shape every
// stat is written in today (interface guidelines, Typography), which is the
// treatment this group asks for.
//
// NOTHING COUNTS UP. The figures are printed once, as text. An animated
// counter is ambient motion in the one place on the page a reader has come
// to read a fact, and `docs/interface-guidelines.md` rejects it outright.
//
// ONE GROUP WIDE, A PLAIN LIST NARROW. Three across where there is room,
// two at middle widths, and one column on a phone — where "a row of cards"
// is a stack of ruled entries read in order, which is what a narrow screen
// should get.
//
// AND AS WIDE AS THE GROUP HAS CONTENT FOR (2026-09-10 vocabulary
// expansion). One card takes the measure, two split it, and three or more
// take the stage's columns. See `arrangementClass` below.
import StatBlock from './blocks/StatBlock.jsx';
import ListItemBlock from './blocks/ListItemBlock.jsx';

const blockKey = (block, index) => block.id ?? `${block.section}__${block.field ?? index}`;

/** A string field with something in it. */
const filled = (value) => typeof value === 'string' && value.trim().length > 0;

/**
 * Whether a block's own renderer would draw anything.
 *
 * ONLY A STAT'S FIELDS ARE CHECKED WHEN CONTENT IS WRITTEN, so a published
 * `list_item` can carry an empty text and a published stat can be missing
 * the half its shape needs. Both renderers already return null for those,
 * which is right on its own — but the grouping counts blocks, and Home
 * opens the section and writes its heading on that count. A block the
 * renderer drops therefore has to be dropped here too, or the reader gets
 * a heading over an empty card.
 *
 * The stat cases mirror StatBlock's own guards: the legacy pair needs both
 * halves, and a block written in the fuller shape needs a figure or a
 * takeaway to put in the term.
 */
function drawsSomething(block) {
  if (block?.blockType === 'list_item') return filled(block.text);
  if (block?.blockType !== 'stat') return false;
  const full =
    filled(block.takeaway) || filled(block.description) || filled(block.source) || filled(block.alt);
  return full ? filled(block.value) || filled(block.takeaway) : filled(block.value) && filled(block.label);
}

/**
 * The section's blocks, grouped into cards.
 *
 * Exported for its own test: the grouping is the part of this component a
 * reader of the admin can get wrong, so it is checked directly rather than
 * only through the rendered output.
 *
 * @param {object[]} blocks one section's ordered blocks
 * @returns {Array<{ key: string, stat: object|null, lines: object[] }>}
 */
export function groupIntoCards(blocks) {
  const cards = [];
  for (const [index, block] of (blocks ?? []).entries()) {
    if (block?.blockType === 'stat') {
      // A fact that draws nothing still opens the card it was written to
      // open, holding no fact: the lines under it were written under it,
      // and folding them into the card above would say they belong to a
      // fact their editor never put them under.
      cards.push({
        key: blockKey(block, index),
        stat: drawsSomething(block) ? block : null,
        lines: [],
      });
      continue;
    }
    if (block?.blockType !== 'list_item') continue;
    if (!drawsSomething(block)) continue;
    // A line with no fact above it opens a card of its own rather than
    // being dropped: an editor who wrote only lines still has a section.
    if (cards.length === 0) {
      cards.push({ key: blockKey(block, index), stat: null, lines: [] });
    }
    cards[cards.length - 1].lines.push(block);
  }
  // A card with nothing left in it is not a card. It would draw an empty
  // box, and its count would tell Home to write the section's heading over
  // that box.
  return cards.filter((card) => card.stat || card.lines.length);
}

/**
 * How wide the group runs, and in how many columns.
 *
 * THE GROUP IS AS WIDE AS IT HAS CONTENT FOR. A single card in a three-column
 * grid drew at a third of the measure, which reads as a cramped box rather
 * than as one fact stated plainly. So the count sets the shape: one card
 * takes the measure, two split it, and three or more take the stage's own
 * columns — which is the only case that has enough content to fill them.
 *
 * `single` is the group inside one cell of the home page's summary row. The
 * cell is already a column of the stage, so the cards run DOWN it whatever
 * the count, and the cell's own width is what bounds them.
 *
 * @param {'auto'|'single'} columns
 * @param {number} count
 * @returns {string}
 */
function arrangementClass(columns, count) {
  if (columns === 'single') return 'grid gap-lg';
  if (count === 1) return 'measure grid gap-lg';
  if (count === 2) return 'measure grid gap-lg sm:grid-cols-2';
  return 'grid gap-lg sm:grid-cols-2 lg:grid-cols-3';
}

/**
 * The cards, already grouped. The caller groups them because it has to know
 * whether the section holds anything this arrangement can draw before it
 * writes the section's own heading: a section holding only some type this
 * file does not draw would otherwise print its heading over nothing, and a
 * heading over nothing is a boundary the reader cannot cross.
 *
 * @param {{
 *   cards: ReturnType<typeof groupIntoCards>,
 *   columns?: 'auto' | 'single',
 * }} props
 */
export default function InfoCards({ cards, columns = 'auto' }) {
  if (!cards?.length) return null;

  return (
    <div className={arrangementClass(columns, cards.length)}>
      {cards.map((card) => (
        <div key={card.key}>
          {/* One card, one fact, so the description list holds one entry.
              StatBlock writes the <dt> and the <dd>, and both need a <dl>
              around them wherever they are. */}
          {card.stat ? (
            <dl>
              <StatBlock block={card.stat} />
            </dl>
          ) : null}
          {card.lines.length ? (
            // No bullets: the card is already the group, and a disc in
            // front of two short lines inside it is a mark that separates
            // nothing. The rule at the top of a card with no fact above it
            // is the one StatBlock would otherwise have drawn, so a card
            // opens on a rule either way.
            <ul
              className={
                card.stat
                  ? 'mt-xs space-y-3xs'
                  : 'space-y-3xs border-t-hairline border-t-rule-hairline pt-sm'
              }
            >
              {card.lines.map((block, index) => (
                <ListItemBlock key={blockKey(block, index)} block={block} />
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
}
