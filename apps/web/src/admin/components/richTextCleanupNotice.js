import { sanitizeHtml } from '../../lib/sanitizeHtml.js';

const BLOCKS = 'p, h2, h3, h4, ul, ol, li, blockquote, pre, hr, br';
const INLINE_FORMATS = [
  ['b, strong', 'bold text'],
  ['i, em', 'italic text'],
  ['u', 'underlined text'],
  ['s', 'strikethrough text'],
  ['code', 'inline code'],
];

function prose(text) {
  return text.replace(/[ \t\r\n\f]+/g, ' ').trim();
}

function publicFeatures(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const root = template.content;
  const blocks = [...root.querySelectorAll(BLOCKS)];
  const tags = (selector) => blocks.filter((node) => node.matches(selector)).map((node) => node.localName).join(',');
  const text = (selector) => [...root.querySelectorAll(selector)]
    .filter((node) => !node.parentElement?.closest(selector))
    .map((node) => node.textContent).join('');
  const links = [...root.querySelectorAll('a')].map((node) => [node.getAttribute('href')?.trim(), prose(node.textContent)]);
  const features = {
    'line breaks': tags('br'),
    'paragraph spacing': blocks.length === 1 && root.firstElementChild?.matches('p') &&
      prose(root.textContent) === prose(root.firstElementChild.textContent) ? '' : tags('p'),
    headings: tags('h2, h3, h4'),
    'list formatting': tags('ul, ol, li'),
    'block quotes': tags('blockquote'),
    dividers: tags('hr'),
    'code blocks': JSON.stringify([...root.querySelectorAll('pre')].map((node) => node.textContent)),
    links: JSON.stringify(links),
  };
  for (const [selector, label] of INLINE_FORMATS) features[label] = prose(text(selector));

  // Text in separate blocks or on either side of a line break reads as
  // separate words even when the source has no whitespace between the tags.
  for (const block of blocks) {
    block.before(' ');
    block.after(' ');
  }
  features.text = prose(root.textContent.replaceAll('\u00a0', ' '));
  features['nonbreaking spaces'] = (root.textContent.match(/\u00a0/g) ?? []).length;
  return features;
}

export function richTextCleanupNotice(stored, cleaned) {
  // Compare what the public renderer keeps. Removed attributes and wrappers
  // that the renderer already ignores cannot create a notice on their own.
  const before = sanitizeHtml(stored, { omitEmbedSourceHeadings: true });
  const after = sanitizeHtml(cleaned, { omitEmbedSourceHeadings: true });
  if (before === after) return '';
  const previous = publicFeatures(before);
  const next = publicFeatures(after);
  const changes = Object.keys(previous).filter((feature) => previous[feature] !== next[feature]);
  if (!changes.length) return '';
  if (changes.join(',') === 'line breaks,paragraph spacing' && !next['line breaks']) {
    return 'The editor replaced line breaks with separate paragraphs.';
  }
  return `The editor changed ${new Intl.ListFormat('en').format(changes)} in this text.`;
}
