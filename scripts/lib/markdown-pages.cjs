'use strict';

/**
 * A small Markdown renderer for the generated documentation site (#108).
 *
 * Scope is deliberate. It covers the constructs the repository's own
 * Markdown actually uses, and nothing else:
 *
 *   blocks   ATX headings, fenced code, GFM pipe tables, bullet and
 *            ordered lists (nested, tight or loose), task-list items,
 *            block quotes, thematic breaks, paragraphs
 *   inline   code spans, links, images, autolinks, strong, emphasis,
 *            strikethrough, hard line breaks, backslash escapes
 *
 * Two omissions are intentional:
 *
 *   Indented code blocks are NOT supported. Every four-space-indented
 *   line in this repository's docs is a list-item continuation, so
 *   treating indentation as code would wreck those lists.
 *
 *   Raw HTML is NOT passed through. Every `<` in the source is escaped,
 *   so a doc that writes `<GCP_PROJECT_ID>` renders that text instead of
 *   opening a tag, and no Markdown file can inject markup into the site.
 *
 * There is no dependency here on purpose. The documentation CI tier runs
 * on the runner's Node with no `npm install`, so this file and its tests
 * must work from a bare checkout.
 */

const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const PUNCTUATION_RE = /[!-/:-@[-`{-~]/;
const AUTOLINK_RE = /^<((?:https?|mailto):[^\s<>]+)>/;
const EMAIL_AUTOLINK_RE = /^<([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>/;
const LIST_MARKER_RE = /^(\s*)(?:([-*+])|(\d{1,9})([.)]))(\s+)(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE_RE = /^(\s*)(`{3,}|~{3,})\s*(\S*)\s*$/;
const THEMATIC_BREAK_RE = /^(?:\s*)(?:-{3,}|\*{3,}|_{3,})\s*$/;
const TABLE_DELIMITER_RE = /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/;

/**
 * Escape every character that could change the meaning of the surrounding
 * markup. Applied to all text taken from Markdown, including code spans.
 *
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * GitHub-compatible heading slug: lowercase, punctuation dropped, spaces
 * hyphenated. Matching GitHub matters because the source Markdown links to
 * its own headings with anchors readers already have bookmarked.
 *
 * @param {string} text heading text, Markdown syntax already stripped
 * @returns {string}
 */
function slugify(text) {
  return String(text)
    .trim()
    .toLowerCase()
    // Underscores and hyphens survive, as they do in GitHub's own slugs:
    // `AUTO_DEPLOY_ENVIRONMENTS` must keep them.
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-');
}

/**
 * Strip inline Markdown syntax so a heading can be slugged and reused as a
 * plain-text page title or description.
 *
 * @param {string} text
 * @returns {string}
 */
function plainText(text) {
  return String(text)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    // `*` and `~` only ever mark emphasis here, but `_` is a normal
    // character in the environment-variable names these docs are full of.
    .replace(/(\*{1,2}|~~|__)/g, '')
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function indentWidth(line) {
  const match = /^[ \t]*/.exec(line)[0];
  let width = 0;
  for (const character of match) width += character === '\t' ? 4 : 1;
  return width;
}

/**
 * Index of the closing run of exactly `length` backticks, or -1.
 *
 * @param {string} source
 * @param {number} from index to start searching
 * @param {number} length
 * @returns {number}
 */
function findCodeSpanEnd(source, from, length) {
  let index = from;
  while (index < source.length) {
    if (source[index] !== '`') {
      index += 1;
      continue;
    }
    const run = /^`+/.exec(source.slice(index))[0].length;
    if (run === length) return index;
    index += run;
  }
  return -1;
}

/**
 * Scan forward for a closing delimiter, skipping escapes and code spans so
 * that a `*` inside `` `a * b` `` never closes emphasis.
 *
 * @param {string} source
 * @param {number} from
 * @param {string} delimiter
 * @returns {number} index of the delimiter, or -1
 */
function findDelimiter(source, from, delimiter) {
  let index = from;
  while (index < source.length) {
    const character = source[index];
    if (character === '\\') {
      index += 2;
      continue;
    }
    if (character === '`') {
      const run = /^`+/.exec(source.slice(index))[0].length;
      const end = findCodeSpanEnd(source, index + run, run);
      index = end === -1 ? index + run : end + run;
      continue;
    }
    if (source.startsWith(delimiter, index)) {
      // A single `*` must not match the first half of a `**` run.
      if (delimiter.length === 1 && source[index + 1] === delimiter) {
        index += 2;
        continue;
      }
      return index;
    }
    index += 1;
  }
  return -1;
}

/**
 * Index of the `]` matching the `[` at `from - 1`, accounting for nesting,
 * escapes, and code spans.
 *
 * @param {string} source
 * @param {number} from index just after the opening bracket
 * @returns {number}
 */
function findLabelEnd(source, from) {
  let depth = 1;
  let index = from;
  while (index < source.length) {
    const character = source[index];
    if (character === '\\') {
      index += 2;
      continue;
    }
    if (character === '`') {
      const run = /^`+/.exec(source.slice(index))[0].length;
      const end = findCodeSpanEnd(source, index + run, run);
      index = end === -1 ? index + run : end + run;
      continue;
    }
    if (character === '[') depth += 1;
    if (character === ']') {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }
  return -1;
}

/**
 * Parse a `(destination "title")` target starting at the open paren.
 *
 * @param {string} source
 * @param {number} from index of `(`
 * @returns {{ destination: string, title: string, end: number } | null}
 */
function parseLinkTarget(source, from) {
  if (source[from] !== '(') return null;
  let index = from + 1;
  let depth = 1;
  let raw = '';
  while (index < source.length) {
    const character = source[index];
    if (character === '\\') {
      raw += source.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (character === '(') depth += 1;
    if (character === ')') {
      depth -= 1;
      if (depth === 0) break;
    }
    raw += character;
    index += 1;
  }
  if (index >= source.length) return null;
  let destination = raw.trim();
  let title = '';
  const titleMatch = /\s+(?:"([^"]*)"|'([^']*)')$/.exec(destination);
  if (titleMatch) {
    title = titleMatch[1] ?? titleMatch[2] ?? '';
    destination = destination.slice(0, titleMatch.index).trim();
  }
  if (destination.startsWith('<') && destination.endsWith('>')) {
    destination = destination.slice(1, -1);
  }
  return { destination: destination.replace(/\\([!-/:-@[-`{-~])/g, '$1'), title, end: index + 1 };
}

/**
 * Render inline Markdown to HTML.
 *
 * @param {string} source
 * @param {{ resolveLink?: (href: string) => string, allowLinks?: boolean }} [context]
 * @returns {string}
 */
function renderInline(source, context = {}) {
  const resolveLink = context.resolveLink || ((href) => href);
  const allowLinks = context.allowLinks !== false;
  let out = '';
  let index = 0;

  const emphasis = [
    ['***', 'strong-em'],
    ['**', 'strong'],
    ['__', 'strong'],
    ['~~', 'del'],
    ['*', 'em'],
    ['_', 'em'],
  ];

  while (index < source.length) {
    const character = source[index];

    if (character === '\\' && PUNCTUATION_RE.test(source[index + 1] || '')) {
      out += escapeHtml(source[index + 1]);
      index += 2;
      continue;
    }

    if (character === '`') {
      const run = /^`+/.exec(source.slice(index))[0].length;
      const end = findCodeSpanEnd(source, index + run, run);
      if (end !== -1) {
        let code = source.slice(index + run, end);
        if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ')) code = code.slice(1, -1);
        out += `<code>${escapeHtml(code)}</code>`;
        index = end + run;
        continue;
      }
    }

    if (character === '<') {
      const rest = source.slice(index);
      const link = AUTOLINK_RE.exec(rest);
      if (link) {
        const href = resolveLink(link[1]);
        out += `<a href="${escapeHtml(href)}">${escapeHtml(link[1])}</a>`;
        index += link[0].length;
        continue;
      }
      const email = EMAIL_AUTOLINK_RE.exec(rest);
      if (email) {
        out += `<a href="mailto:${escapeHtml(email[1])}">${escapeHtml(email[1])}</a>`;
        index += email[0].length;
        continue;
      }
    }

    const isImage = character === '!' && source[index + 1] === '[';
    if (allowLinks && (character === '[' || isImage)) {
      const labelStart = index + (isImage ? 2 : 1);
      const labelEnd = findLabelEnd(source, labelStart);
      const target = labelEnd === -1 ? null : parseLinkTarget(source, labelEnd + 1);
      if (target) {
        const label = source.slice(labelStart, labelEnd);
        const href = escapeHtml(resolveLink(target.destination));
        const title = target.title ? ` title="${escapeHtml(target.title)}"` : '';
        if (isImage) {
          out += `<img src="${href}" alt="${escapeHtml(plainText(label))}"${title}>`;
        } else {
          const inner = renderInline(label, { ...context, allowLinks: false });
          out += `<a href="${href}"${title}>${inner}</a>`;
        }
        index = target.end;
        continue;
      }
    }

    let matched = false;
    for (const [delimiter, kind] of emphasis) {
      if (!source.startsWith(delimiter, index)) continue;
      // `_` inside a word (snake_case) is not emphasis.
      if (delimiter === '_' && /[\p{L}\p{N}]/u.test(source[index - 1] || '')) continue;
      const end = findDelimiter(source, index + delimiter.length, delimiter);
      if (end === -1) continue;
      const inner = renderInline(source.slice(index + delimiter.length, end), context);
      if (kind === 'strong-em') out += `<strong><em>${inner}</em></strong>`;
      else if (kind === 'strong') out += `<strong>${inner}</strong>`;
      else if (kind === 'del') out += `<del>${inner}</del>`;
      else out += `<em>${inner}</em>`;
      index = end + delimiter.length;
      matched = true;
      break;
    }
    if (matched) continue;

    if (character === '\n') {
      // Two trailing spaces before the newline is a hard break.
      out = out.endsWith('  ') ? `${out.replace(/ +$/, '')}<br>\n` : `${out}\n`;
      index += 1;
      continue;
    }

    out += escapeHtml(character);
    index += 1;
  }

  return out;
}

/**
 * Split one table row into cells on unescaped pipes.
 *
 * @param {string} line
 * @returns {string[]}
 */
function splitTableRow(line) {
  const cells = [];
  let current = '';
  let index = 0;
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  while (index < trimmed.length) {
    const character = trimmed[index];
    if (character === '\\' && trimmed[index + 1] === '|') {
      current += '|';
      index += 2;
      continue;
    }
    if (character === '`') {
      const run = /^`+/.exec(trimmed.slice(index))[0].length;
      const end = findCodeSpanEnd(trimmed, index + run, run);
      const stop = end === -1 ? trimmed.length : end + run;
      current += trimmed.slice(index, stop);
      index = stop;
      continue;
    }
    if (character === '|') {
      cells.push(current.trim());
      current = '';
      index += 1;
      continue;
    }
    current += character;
    index += 1;
  }
  cells.push(current.trim());
  return cells;
}

function alignmentsFrom(delimiterLine) {
  return splitTableRow(delimiterLine).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return '';
  });
}

function matchListMarker(line) {
  const match = LIST_MARKER_RE.exec(line);
  if (!match) return null;
  const [, indent, bullet, number, delimiter, spacing, rest] = match;
  if (bullet && THEMATIC_BREAK_RE.test(line)) return null;
  return {
    indent: indent.length,
    ordered: Boolean(number),
    start: number ? Number(number) : null,
    contentIndent: indent.length + (bullet ? 1 : number.length + delimiter.length) + spacing.length,
    rest,
  };
}

function isBlockStart(line) {
  return HEADING_RE.test(line) ||
    FENCE_RE.test(line) ||
    THEMATIC_BREAK_RE.test(line) ||
    /^\s*>/.test(line) ||
    matchListMarker(line) !== null;
}

/**
 * Render a sequence of lines as block-level Markdown.
 *
 * @param {string[]} lines
 * @param {object} context
 * @returns {string}
 */
function renderBlocks(lines, context) {
  const out = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const [, indent, marker, language] = fence;
      const body = [];
      index += 1;
      while (index < lines.length) {
        const closing = FENCE_RE.exec(lines[index]);
        if (closing && closing[2][0] === marker[0] && closing[2].length >= marker.length && !closing[3]) {
          index += 1;
          break;
        }
        body.push(lines[index].slice(indent.length));
        index += 1;
      }
      const languageClass = language ? ` class="language-${escapeHtml(language)}"` : '';
      out.push(`<pre><code${languageClass}>${escapeHtml(body.join('\n'))}\n</code></pre>`);
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      const slug = context.registerHeading(level, text);
      out.push(
        `<h${level} id="${escapeHtml(slug)}">${renderInline(text, context)}` +
        `<a class="heading-anchor" href="#${escapeHtml(slug)}" aria-label="Link to this section">#</a></h${level}>`,
      );
      index += 1;
      continue;
    }

    if (THEMATIC_BREAK_RE.test(line)) {
      out.push('<hr>');
      index += 1;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quoted = [];
      while (index < lines.length && (/^\s*>/.test(lines[index]) || (quoted.length > 0 && lines[index].trim() !== ''))) {
        quoted.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      out.push(`<blockquote>\n${renderBlocks(quoted, context)}\n</blockquote>`);
      continue;
    }

    if (line.trim().startsWith('|') && index + 1 < lines.length && TABLE_DELIMITER_RE.test(lines[index + 1])) {
      const header = splitTableRow(line);
      const alignments = alignmentsFrom(lines[index + 1]);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      const cell = (tag, value, column) => {
        const align = alignments[column] ? ` style="text-align:${alignments[column]}"` : '';
        return `<${tag}${align}>${renderInline(value, context)}</${tag}>`;
      };
      const head = header.map((value, column) => cell('th', value, column)).join('');
      const body = rows
        .map((row) => `<tr>${row.map((value, column) => cell('td', value, column)).join('')}</tr>`)
        .join('\n');
      out.push(
        '<div class="table-scroll">\n<table>\n<thead>\n' +
        `<tr>${head}</tr>\n</thead>\n<tbody>\n${body}\n</tbody>\n</table>\n</div>`,
      );
      continue;
    }

    const marker = matchListMarker(line);
    if (marker) {
      const list = collectList(lines, index, context);
      out.push(list.html);
      index = list.index;
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim() !== '' && !isBlockStart(lines[index])) {
      if (lines[index].trim().startsWith('|') && TABLE_DELIMITER_RE.test(lines[index + 1] || '')) break;
      paragraph.push(lines[index].replace(/^\s+/, ''));
      index += 1;
    }
    if (paragraph.length === 0) {
      // A line that starts a block but was not consumed above cannot be
      // reached; guard anyway so a malformed document cannot spin here.
      paragraph.push(lines[index].trim());
      index += 1;
    }
    out.push(`<p>${renderInline(paragraph.join('\n'), context)}</p>`);
  }

  return out.join('\n');
}

/**
 * Collect one list, including nested lists and multi-paragraph items.
 *
 * @param {string[]} lines
 * @param {number} start
 * @param {object} context
 * @returns {{ html: string, index: number }}
 */
function collectList(lines, start, context) {
  const first = matchListMarker(lines[start]);
  const items = [];
  let index = start;
  let loose = false;

  while (index < lines.length) {
    const marker = matchListMarker(lines[index]);
    if (!marker || marker.indent !== first.indent || marker.ordered !== first.ordered) break;

    const itemLines = [marker.rest];
    index += 1;
    while (index < lines.length) {
      const current = lines[index];
      if (current.trim() === '') {
        let lookahead = index;
        while (lookahead < lines.length && lines[lookahead].trim() === '') lookahead += 1;
        if (lookahead < lines.length && indentWidth(lines[lookahead]) >= marker.contentIndent) {
          itemLines.push('');
          loose = true;
          index += 1;
          continue;
        }
        break;
      }
      if (indentWidth(current) >= marker.contentIndent) {
        itemLines.push(current.slice(marker.contentIndent));
        index += 1;
        continue;
      }
      // Lazy continuation: a wrapped paragraph line under-indented but not
      // starting a block of its own.
      if (!isBlockStart(current) && itemLines[itemLines.length - 1].trim() !== '') {
        itemLines.push(current.trim());
        index += 1;
        continue;
      }
      break;
    }
    items.push(itemLines);
  }

  const rendered = items.map((itemLines) => {
    let body = itemLines;
    let checkbox = '';
    const task = /^\[([ xX])\]\s+(.*)$/.exec(body[0] || '');
    if (task) {
      const checked = task[1].toLowerCase() === 'x' ? ' checked' : '';
      checkbox = `<input type="checkbox" disabled${checked}> `;
      body = [task[2], ...body.slice(1)];
    }
    let html = renderBlocks(body, context);
    // A tight item's leading paragraph is not wrapped in `p`. A blank line
    // anywhere in the list makes it loose, so an item can only ever have
    // one such paragraph to unwrap.
    if (!loose) {
      html = `${checkbox}${html.replace(/^<p>/, '').replace('</p>', '')}`;
    } else if (checkbox && html.startsWith('<p>')) {
      html = `<p>${checkbox}${html.slice(3)}`;
    } else {
      html = `${checkbox}${html}`;
    }
    return `<li${task ? ' class="task-item"' : ''}>${html}</li>`;
  });

  const tag = first.ordered ? 'ol' : 'ul';
  const startAttribute = first.ordered && first.start !== 1 ? ` start="${first.start}"` : '';
  return {
    html: `<${tag}${startAttribute}>\n${rendered.map((item) => item).join('\n')}\n</${tag}>`,
    index,
  };
}

/**
 * Render a Markdown document.
 *
 * @param {string} source Markdown text
 * @param {{ resolveLink?: (href: string) => string }} [options]
 * @returns {{ html: string, title: string|null, headings: Array<{level:number,text:string,slug:string}>, description: string }}
 */
function renderMarkdown(source, options = {}) {
  const text = String(source).replace(/\r\n/g, '\n').replace(HTML_COMMENT_RE, '');
  const headings = [];
  const used = new Map();
  const context = {
    resolveLink: options.resolveLink,
    registerHeading(level, raw) {
      const plain = plainText(raw);
      const base = slugify(plain) || 'section';
      const seen = used.get(base) || 0;
      used.set(base, seen + 1);
      const slug = seen === 0 ? base : `${base}-${seen}`;
      headings.push({ level, text: plain, slug });
      return slug;
    },
  };

  const lines = text.split('\n');
  // The page shell renders the document title as the `h1`, so the leading
  // `# Title` is consumed here rather than repeated in the article body.
  let title = null;
  let bodyLines = lines;
  const firstContent = lines.findIndex((line) => line.trim() !== '');
  if (firstContent !== -1) {
    const heading = HEADING_RE.exec(lines[firstContent]);
    if (heading && heading[1].length === 1) {
      title = plainText(heading[2]);
      bodyLines = lines.slice(firstContent + 1);
    }
  }

  const html = renderBlocks(bodyLines, context);
  const firstParagraph = /<p>([\s\S]*?)<\/p>/.exec(html);
  const description = firstParagraph
    ? plainText(firstParagraph[1].replace(/<[^>]+>/g, ''))
      .replaceAll('&amp;', '&')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
    : '';

  return { html, title, headings, description };
}

module.exports = {
  escapeHtml,
  plainText,
  renderInline,
  renderMarkdown,
  slugify,
  internals: { splitTableRow, matchListMarker },
};
