// Rule — a hairline, strong, or nameplate rule as a standalone element
// (design brief §2.1, §3.7).
//
// Rules are structure, not decoration: a rule replaces a card border, and it
// never carries brand color. Every weight resolves through the `--rule-*`
// tokens, so a preset retunes rules without touching a component.
//
// Draw a rule with THIS component when it stands on its own (a section
// boundary, a masthead cut-off). Where the rule belongs to something that is
// already a box — a list row, a table row — put the border on that element
// with `border-t-hairline border-t-rule-hairline` instead of stacking an
// extra node into the DOM.
//
// A rule is decorative to a screen reader. It is not an `<hr>`: `<hr>` is a
// thematic break with meaning, and these rules divide a layout the heading
// structure already describes.

/**
 * Weight → the classes that draw it.
 *
 * `strong` resolves through the tier-3 `--section-rule-*` contract (the
 * `.section-rule` class in index.css), because a strong rule in this system
 * is always the one rule that opens a section. The other two read the tier-2
 * width and color tokens directly.
 */
const RULE_CLASS = {
  hairline: 'border-t-hairline border-t-rule-hairline',
  strong: 'section-rule',
  nameplate: 'border-t-nameplate border-t-rule-nameplate',
};

/**
 * @param {{ weight?: 'hairline' | 'strong' | 'nameplate', className?: string }} props
 */
export default function Rule({ weight = 'hairline', className = '' }) {
  const rule = RULE_CLASS[weight] ?? RULE_CLASS.hairline;
  return <div aria-hidden="true" className={[rule, className].filter(Boolean).join(' ')} />;
}
