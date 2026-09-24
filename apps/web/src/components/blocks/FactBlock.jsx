// fact: a non-numeric fact (BLOCK_TYPES.fact, issue #234).
//
// A FACT IS A TERM AND A DESCRIPTION, NEVER A STAT BLOCK (expansion record
// §3.1, definition list row). The home page's key facts asked an operator to
// write a source line and a "what this counts" line for the name of a hall,
// because the only block that could open a card was the stat, and the stat
// carries the evidence contract a figure needs. A venue is not evidence of
// anything. So this block carries three parts and no evidence: the term
// (`label`: "Where"), the description (`value`: the hall's name), and one
// optional line under it (`note`: the address).
//
// It renders through the definition list device, and it renders one PAIR:
// SectionBlocks batches a run of facts into one <dl>, and InfoCards puts one
// pair inside the card it opens, so the <dl> is always the caller's.
import { DefinitionPair } from '../editorial/DefinitionList.jsx';

/** A string field with something in it, or null. */
function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Whether a fact block has both halves of its pair. */
export function factDraws(block) {
  return Boolean(text(block?.label) && text(block?.value));
}

export default function FactBlock({ block }) {
  if (!factDraws(block)) return null;
  return (
    <DefinitionPair term={text(block.label)} note={text(block.note)}>
      {text(block.value)}
    </DefinitionPair>
  );
}
