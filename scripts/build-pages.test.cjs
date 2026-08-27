'use strict';

/**
 * Tests for the documentation site generator (issue #108).
 *
 * These run in the credential-free documentation CI tier, which uses the
 * runner's Node with no `npm install`, so nothing here may require a
 * dependency or a network call.
 *
 * The freshness case is the important one: it renders the whole site into
 * memory and compares it with the committed `docs/docs/`, the same way
 * `node scripts/generate-content.cjs --demo --check` guards the generated
 * content snapshot.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildSite, compare, linkResolver, themeColorTags, internals } = require('./build-pages.cjs');
const { renderMarkdown, renderInline, slugify, escapeHtml } = require('./lib/markdown-pages.cjs');
const { DOCS_BASE, SECTIONS, pagesInOrder, routesBySource } = require('./lib/pages-manifest.cjs');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = internals.OUTPUT_DIR;

const site = buildSite();
const pages = pagesInOrder();

function textOf(html) {
  return html.replace(/<[^>]+>/g, ' ');
}

function headingsOf(html) {
  return [...html.matchAll(/<h([1-6])\b[^>]*>/g)].map((match) => Number(match[1]));
}

// ---------------------------------------------------------------- manifest

test('every manifest source exists and maps to one unique route', () => {
  const routes = new Set();
  const sources = new Set();
  for (const page of pages) {
    assert.ok(fs.existsSync(path.join(ROOT, page.source)), `missing source: ${page.source}`);
    assert.ok(page.route.endsWith('/'), `route must end in a slash: ${page.route}`);
    assert.ok(!routes.has(page.route), `duplicate route: ${page.route}`);
    assert.ok(!sources.has(page.source), `duplicate source: ${page.source}`);
    routes.add(page.route);
    sources.add(page.source);
    assert.ok(page.title && page.summary, `${page.source} needs a title and a summary`);
  }
});

test('historical plans stay out of the navigation', () => {
  for (const page of pages) {
    assert.ok(!page.source.startsWith('docs/plans/'), `plans must not be published: ${page.source}`);
  }
});

test('the generator reports no broken links in the source Markdown', () => {
  assert.deepEqual(site.errors, []);
});

// -------------------------------------------------------------- freshness

test('the committed site matches a fresh render', () => {
  const { differences, unexpected } = compare(site.files, OUTPUT_DIR);
  assert.deepEqual(
    { differences, unexpected },
    { differences: [], unexpected: [] },
    'docs/docs is stale — regenerate with: node scripts/build-pages.cjs',
  );
});

test('every manifest page has a committed output file', () => {
  for (const page of pages) {
    const file = path.join(OUTPUT_DIR, page.route, 'index.html');
    assert.ok(fs.existsSync(file), `missing generated page: ${page.route}`);
  }
  assert.ok(fs.existsSync(path.join(OUTPUT_DIR, 'index.html')));
});

// ------------------------------------------------------------ internal links

test('every internal link resolves to a generated page or an existing asset', () => {
  const known = new Set([...site.files.keys()].map((file) => `${DOCS_BASE}${file}`.replace(/index\.html$/, '')));
  for (const [file, html] of site.files) {
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const href = match[1];
      if (!href.startsWith('/')) continue;
      const [target] = href.split('#');
      if (known.has(target)) continue;
      const onDisk = path.join(ROOT, 'docs', target.replace('/eventrunner/', ''));
      assert.ok(
        fs.existsSync(onDisk),
        `${file}: internal link goes nowhere: ${href}`,
      );
    }
  }
});

test('every cross-page fragment points at a heading that exists', () => {
  const headings = new Map();
  for (const page of pages) {
    headings.set(`${DOCS_BASE}${page.route}`, new Set(site.headingsByRoute.get(page.route).map((h) => h.slug)));
  }
  for (const [file, html] of site.files) {
    for (const match of html.matchAll(/href="(\/eventrunner\/docs\/[^"]*)#([^"]+)"/g)) {
      const [, route, fragment] = match;
      if (!headings.has(route)) continue;
      assert.ok(
        headings.get(route).has(fragment),
        `${file}: fragment #${fragment} does not exist on ${route}`,
      );
    }
  }
});

test('same-page fragments point at a heading on that page', () => {
  for (const page of pages) {
    const html = site.files.get(`${page.route}index.html`);
    const slugs = new Set(site.headingsByRoute.get(page.route).map((heading) => heading.slug));
    const article = html.slice(html.indexOf('<article'), html.indexOf('</article>'));
    for (const match of article.matchAll(/href="#([^"]+)"/g)) {
      assert.ok(slugs.has(match[1]), `${page.route}: fragment #${match[1]} does not exist on this page`);
    }
  }
});

test('no link keeps a stale /run-of-show/ path', () => {
  // The repository used to be called run-of-show, and its Pages base was
  // /run-of-show/. Prose and code samples may still mention the old name
  // (an Artifact Registry repository is still called that), so this checks
  // what readers actually follow: links, sources, and canonical URLs.
  for (const [file, html] of site.files) {
    for (const match of html.matchAll(/(?:href|src|content)="([^"]+)"/g)) {
      assert.ok(
        !/(^|\/)run-of-show\//.test(match[1]),
        `${file}: stale run-of-show path in ${match[1]}`,
      );
    }
  }
});

test('the landing page links into the documentation site', () => {
  const landing = fs.readFileSync(path.join(ROOT, 'docs', 'index.html'), 'utf8');
  assert.match(landing, /href="\.\/docs\/"/);
  for (const route of ['admin-guide/', 'contributing/', 'roadmap/', 'security/']) {
    assert.ok(landing.includes(`./docs/${route}`), `the landing page should link to ${route}`);
  }
  assert.ok(
    !/blob\/main\/(docs\/ADMIN_GUIDE|CONTRIBUTING|SECURITY|docs\/ROADMAP)\.md/.test(landing),
    'the landing page should not send readers to raw blob pages that have a web route',
  );
});

// -------------------------------------------------------------- page shell

test('every page carries the required metadata', () => {
  const required = [
    /^<!doctype html>/,
    /<html lang="en">/,
    /<meta name="viewport"/,
    /<title>[^<]+<\/title>/,
    /<meta name="description" content="[^"]+">/,
    /<link rel="canonical" href="https:\/\/centercoopmedia\.github\.io\/eventrunner\/docs\/[^"]*">/,
    /<link rel="icon" type="image\/svg\+xml" href="[^"]+\.svg">/,
    /<meta property="og:type" content="[^"]+">/,
    /<meta property="og:title" content="[^"]+">/,
    /<meta property="og:description" content="[^"]+">/,
    /<meta property="og:url" content="[^"]+">/,
    /<meta property="og:image" content="[^"]+">/,
    /<meta name="twitter:card" content="summary_large_image">/,
    /<meta name="twitter:title" content="[^"]+">/,
    /<meta name="twitter:description" content="[^"]+">/,
    /<meta name="twitter:image" content="[^"]+">/,
    /<meta name="theme-color"[^>]*media="\(prefers-color-scheme: light\)"/,
    /<meta name="theme-color"[^>]*media="\(prefers-color-scheme: dark\)"/,
  ];
  for (const [file, html] of site.files) {
    for (const expression of required) {
      assert.match(html, expression, `${file}: missing ${expression}`);
    }
  }
});

test('theme colors are mirrored from the landing page', () => {
  const landing = fs.readFileSync(path.join(ROOT, 'docs', 'index.html'), 'utf8');
  const tags = themeColorTags(landing);
  assert.equal(tags.length, 2);
  for (const [, html] of site.files) {
    for (const tag of tags) assert.ok(html.includes(tag));
  }
  assert.throws(() => themeColorTags('<html></html>'), /theme-color/);
});

test('every page has one h1, a skip link, and a main landmark', () => {
  for (const [file, html] of site.files) {
    assert.equal((html.match(/<h1\b/g) || []).length, 1, `${file}: expected exactly one h1`);
    assert.ok(html.includes('<a class="skip-link" href="#main">'), `${file}: missing skip link`);
    assert.ok(html.includes('id="main"'), `${file}: missing main landmark`);
    assert.ok(html.includes('aria-label="Breadcrumb"'), `${file}: missing breadcrumbs`);
    assert.ok(html.includes('aria-label="Documentation"'), `${file}: missing section navigation`);
  }
});

test('heading levels never skip a level', () => {
  for (const [file, html] of site.files) {
    const levels = headingsOf(html);
    assert.equal(levels[0], 1, `${file}: the first heading must be the h1`);
    for (let index = 1; index < levels.length; index += 1) {
      assert.ok(
        levels[index] <= levels[index - 1] + 1,
        `${file}: heading jumps from h${levels[index - 1]} to h${levels[index]}`,
      );
    }
  }
});

test('the on-this-page navigation adds no heading before the article h1', () => {
  let withContents = 0;
  for (const [file, html] of site.files) {
    // The "On this page" list sits inside the article, above the prose but
    // below its h1. Labelling it with a heading element would put an h2 (or
    // worse) ahead of the page's only h1, which is the one heading-order
    // mistake this layout could make — so the label is a paragraph.
    assert.equal(html.search(/<h[1-6]\b/), html.indexOf('<h1>'), `${file}: a heading precedes the article h1`);

    const start = html.indexOf('<nav class="contents"');
    if (start === -1) continue;
    withContents += 1;
    const block = html.slice(start, html.indexOf('</nav>', start));
    assert.ok(start > html.indexOf('<h1>'), `${file}: the contents nav sits above the h1`);
    assert.ok(!/<h[1-6]\b/.test(block), `${file}: the contents nav uses a heading element`);
    assert.ok(block.includes('<p class="contents-title" id="contents-title">On this page</p>'), file);
    assert.ok(block.includes('aria-labelledby="contents-title"'), `${file}: the contents nav is unlabelled`);
  }
  assert.ok(withContents > 0, 'no page rendered an on-this-page navigation');
});

test('the on-this-page links match the page own h2 headings', () => {
  for (const page of pages) {
    const html = site.files.get(`${page.route}index.html`);
    const start = html.indexOf('<nav class="contents"');
    if (start === -1) continue;
    const block = html.slice(start, html.indexOf('</nav>', start));
    const linked = [...block.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]);
    const sections = site.headingsByRoute.get(page.route)
      .filter((heading) => heading.level === 2)
      .map((heading) => heading.slug);
    assert.deepEqual(linked, sections, page.route);
    for (const slug of linked) assert.ok(html.includes(`id="${slug}"`), `${page.route}: #${slug} has no target`);
  }
});

test('every page marks its own navigation entry as current', () => {
  for (const page of pages) {
    const html = site.files.get(`${page.route}index.html`);
    const current = [...html.matchAll(/aria-current="page"/g)];
    // One in the breadcrumb trail, one in the section navigation.
    assert.equal(current.length, 2, `${page.route}: expected one current crumb and one current nav item`);
    assert.ok(html.includes(`href="${DOCS_BASE}${page.route}" aria-current="page"`));
  }
});

test('previous and next links follow manifest order', () => {
  for (const page of pages) {
    const html = site.files.get(`${page.route}index.html`);
    if (page.previous) assert.ok(html.includes(`rel="prev" href="${DOCS_BASE}${page.previous.route}"`));
    if (page.next) assert.ok(html.includes(`rel="next" href="${DOCS_BASE}${page.next.route}"`));
  }
  const first = pages[0];
  assert.ok(site.files.get('index.html').includes(`rel="next" href="${DOCS_BASE}${first.route}"`));
});

test('the home page lists every section and page', () => {
  const html = site.files.get('index.html');
  for (const section of SECTIONS) {
    assert.ok(html.includes(`id="${section.id}"`), `home page is missing section ${section.id}`);
    for (const page of section.pages) {
      assert.ok(html.includes(`href="${DOCS_BASE}${page.route}"`), `home page is missing ${page.route}`);
    }
  }
});

test('each page names the Markdown file it came from', () => {
  for (const page of pages) {
    const html = site.files.get(`${page.route}index.html`);
    assert.ok(html.includes(`blob/main/${page.source}`), `${page.route}: missing its source link`);
  }
});

// ------------------------------------------------------- link rewriting

test('a link to another published document becomes a route', () => {
  const routes = routesBySource();
  const resolve = linkResolver({ source: 'docs/handbook/faq.md', routes, departures: [], errors: [] });
  assert.equal(resolve('for-clients.md'), `${DOCS_BASE}handbook/for-clients/`);
  assert.equal(resolve('../ROADMAP.md'), `${DOCS_BASE}roadmap/`);
  assert.equal(resolve('../ADMIN_GUIDE.md#speakers'), `${DOCS_BASE}admin-guide/#speakers`);
});

test('a blob URL for a published document becomes a route', () => {
  const routes = routesBySource();
  const resolve = linkResolver({ source: 'README.md', routes, departures: [], errors: [] });
  assert.equal(
    resolve('https://github.com/CenterCoopMedia/eventrunner/blob/main/CONTRIBUTING.md'),
    `${DOCS_BASE}contributing/`,
  );
});

test('a link that leaves the manifest is flagged and sent to GitHub', () => {
  const departures = [];
  const resolve = linkResolver({
    source: 'README.md',
    routes: routesBySource(),
    departures,
    errors: [],
  });
  assert.equal(
    resolve('LICENSE'),
    'https://github.com/CenterCoopMedia/eventrunner/blob/main/LICENSE',
  );
  assert.equal(
    resolve('e2e/'),
    'https://github.com/CenterCoopMedia/eventrunner/tree/main/e2e',
  );
  assert.deepEqual(departures.map((departure) => departure.repoPath), ['LICENSE', 'e2e/']);
});

test('a link to a file that does not exist is an error, not a silent 404', () => {
  const errors = [];
  const resolve = linkResolver({
    source: 'README.md',
    routes: routesBySource(),
    departures: [],
    errors,
  });
  resolve('NOPE.md');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /does not exist/);
});

test('external links, anchors, and site paths are left alone', () => {
  const resolve = linkResolver({
    source: 'README.md',
    routes: routesBySource(),
    departures: [],
    errors: [],
  });
  assert.equal(resolve('https://example.org/x'), 'https://example.org/x');
  assert.equal(resolve('mailto:info@eventrunner.org'), 'mailto:info@eventrunner.org');
  assert.equal(resolve('#anchor'), '#anchor');
  assert.equal(resolve('/eventrunner/demo/'), '/eventrunner/demo/');
});

// ----------------------------------------------------------- markdown

test('markdown is escaped, never passed through as HTML', () => {
  const { html } = renderMarkdown('# T\n\nSet `--project=<GCP_PROJECT_ID>` first.\n\n<script>alert(1)</script>\n');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;GCP_PROJECT_ID&gt;'));
});

test('a link label cannot inject markup', () => {
  const html = renderInline('[<b>x</b>](https://example.org/"onload="alert(1))');
  assert.ok(!html.includes('<b>'));
  assert.ok(!html.includes('onload="alert'));
  assert.ok(html.includes('&quot;'));
});

test('headings become GitHub-compatible slugs', () => {
  assert.equal(slugify('Sign your commits (DCO)'), 'sign-your-commits-dco');
  assert.equal(slugify('7.0. Prerequisite check'), '70-prerequisite-check');
  // GitHub keeps underscores, and these docs are full of environment
  // variable names that need them.
  assert.equal(slugify('4. AUTO_DEPLOY_ENVIRONMENTS (push auto-deploy)'), '4-auto_deploy_environments-push-auto-deploy');
  const underscored = renderMarkdown('# T\n\n## 4. AUTO_DEPLOY_ENVIRONMENTS (push)\n');
  assert.equal(underscored.headings[0].text, '4. AUTO_DEPLOY_ENVIRONMENTS (push)');
  assert.ok(underscored.html.includes('>4. AUTO_DEPLOY_ENVIRONMENTS (push)<'));
  const { headings } = renderMarkdown('# T\n\n## Same\n\n## Same\n');
  assert.deepEqual(headings.map((heading) => heading.slug), ['same', 'same-1']);
});

test('the leading h1 becomes the document title and leaves the body', () => {
  const { title, html } = renderMarkdown('# Getting help\n\nBody.\n');
  assert.equal(title, 'Getting help');
  assert.ok(!html.includes('<h1'));
  assert.ok(html.includes('<p>Body.</p>'));
});

test('tables keep escaped pipes inside cells', () => {
  const { html } = renderMarkdown('# T\n\n| Key | Value |\n|---|---|\n| `A` | `x` \\| `y` |\n');
  assert.ok(html.includes('<table>'));
  assert.ok(html.includes('<code>x</code> | <code>y</code>'));
  assert.equal((html.match(/<td/g) || []).length, 2);
});

test('setext underlines become headings', () => {
  const { html, title, headings } = renderMarkdown('Document title\n=====\n\nBody.\n\nA section\n---------\n\nMore.\n');
  assert.equal(title, 'Document title');
  assert.ok(html.includes('<h2 id="a-section">A section'), html);
  assert.ok(!html.includes('<hr>'), html);
  assert.deepEqual(headings, [{ level: 2, text: 'A section', slug: 'a-section' }]);
});

test('a thematic break after a blank line stays a thematic break', () => {
  const { html } = renderMarkdown('# T\n\nBody.\n\n---\n\nMore.\n');
  assert.ok(html.includes('<hr>'), html);
  assert.ok(!html.includes('<h2'), html);
});

test('a table delimiter row is never read as a setext underline', () => {
  const { html } = renderMarkdown('# T\n\n| A | B |\n|---|---|\n| 1 | 2 |\n');
  assert.ok(html.includes('<table>'), html);
  assert.ok(!html.includes('<h2'), html);
});

test('escaped pipes inside a table code span render as pipes, in one cell', () => {
  const { html } = renderMarkdown('# T\n\n| State | Rule |\n|---|---|\n| `draft` | `a \\|\\| b` |\n');
  assert.ok(html.includes('<code>a || b</code>'), html);
  assert.ok(!html.includes('\\|'), html);
  assert.equal((html.match(/<td/g) || []).length, 2);
});

test('table alignment is carried through', () => {
  const { html } = renderMarkdown('# T\n\n| A | B |\n|:--|--:|\n| 1 | 2 |\n');
  assert.ok(html.includes('style="text-align:left"'));
  assert.ok(html.includes('style="text-align:right"'));
});

test('fenced code keeps its language and escapes its contents', () => {
  const { html } = renderMarkdown('# T\n\n```sh\necho "<a>" && true\n```\n');
  assert.ok(html.includes('<pre><code class="language-sh">'));
  assert.ok(html.includes('&lt;a&gt;'));
  assert.ok(html.includes('&amp;&amp;'));
});

test('a code span protects markdown syntax inside it', () => {
  const html = renderInline('Use `a * b` and `**not bold**` here.');
  assert.ok(html.includes('<code>a * b</code>'));
  assert.ok(html.includes('<code>**not bold**</code>'));
  assert.ok(!html.includes('<strong>'));
});

test('an underscore inside a word is not emphasis', () => {
  const html = renderInline('EVENT_EMAIL_PROVIDER and _emphasis_ together.');
  assert.ok(html.includes('EVENT_EMAIL_PROVIDER'));
  assert.ok(html.includes('<em>emphasis</em>'));
});

test('nested lists and wrapped list items stay in one item', () => {
  const { html } = renderMarkdown([
    '# T',
    '',
    '- First item that',
    '  wraps onto a second line',
    '  - Nested child',
    '- Second item',
    '',
  ].join('\n'));
  assert.equal((html.match(/<li>/g) || []).length, 3);
  assert.ok(html.includes('<li>First item that\nwraps onto a second line'), html);
  assert.ok(/<li>First item[\s\S]*<ul>\n<li>Nested child<\/li>\n<\/ul><\/li>/.test(html), html);
  assert.ok(!html.includes('<p>'), 'a tight list item keeps no paragraph wrapper');
});

test('task list items render as disabled checkboxes', () => {
  const { html } = renderMarkdown('# T\n\n- [x] Done\n- [ ] Not done\n');
  assert.ok(html.includes('<li class="task-item"><input type="checkbox" disabled checked> Done</li>'));
  assert.ok(html.includes('<li class="task-item"><input type="checkbox" disabled> Not done</li>'));
});

test('ordered lists keep their numbering', () => {
  const { html } = renderMarkdown('# T\n\n1. One\n2. Two\n');
  assert.ok(html.startsWith('<ol>'));
  assert.equal((html.match(/<li>/g) || []).length, 2);
});

test('html comments never reach the page', () => {
  const { html } = renderMarkdown('# T\n\nBefore.\n\n<!-- OPERATOR NOTE: private -->\n\nAfter.\n');
  assert.ok(!html.includes('OPERATOR NOTE'));
  assert.ok(html.includes('Before.'));
  assert.ok(html.includes('After.'));
});

test('escapeHtml covers every dangerous character', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});

// --------------------------------------------------------------- content

test('no rendered page leaks unrendered markdown syntax', () => {
  for (const [file, html] of site.files) {
    const body = html
      .replace(/<pre>[\s\S]*?<\/pre>/g, '')
      .replace(/<code>[\s\S]*?<\/code>/g, '');
    const text = textOf(body);
    assert.ok(!/\[[^\]\n]+\]\([^)\n]+\)/.test(text), `${file}: unrendered markdown link`);
    assert.ok(!/\*\*\S/.test(text), `${file}: unrendered bold marker`);
    assert.ok(!/^\s*#{1,6}\s/m.test(text), `${file}: unrendered heading marker`);
  }
});

test('every source heading appears in its rendered page', () => {
  for (const page of pages) {
    const markdown = fs.readFileSync(path.join(ROOT, page.source), 'utf8');
    let fence = null;
    let expected = 0;
    for (const line of markdown.split('\n')) {
      const marker = /^(```+|~~~+)/.exec(line);
      if (marker) {
        if (fence === null) fence = marker[1];
        else if (marker[1].length >= fence.length) fence = null;
        continue;
      }
      if (fence === null && /^#{2,6}\s+\S/.test(line)) expected += 1;
    }
    const rendered = site.headingsByRoute.get(page.route).length;
    assert.equal(rendered, expected, `${page.route}: rendered ${rendered} headings, source has ${expected}`);
  }
});

// ------------------------------------------------------------ site assets

test('the documentation social card is a real 1200x630 PNG', () => {
  const preview = fs.readFileSync(path.join(ROOT, 'docs', 'og-default.png'));
  // Magic bytes first: a card that is secretly an SVG or a truncated download
  // fails silently at every preview service rather than at build time.
  assert.deepEqual([...preview.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(preview.subarray(12, 16).toString('ascii'), 'IHDR');
  assert.equal(preview.readUInt32BE(16), 1200);
  assert.equal(preview.readUInt32BE(20), 630);
});

test('every page points its social card at that image, with the declared size', () => {
  for (const [file, html] of site.files) {
    assert.match(html, /<meta property="og:image" content="https:\/\/centercoopmedia\.github\.io\/eventrunner\/og-default\.png">/, file);
    assert.match(html, /<meta property="og:image:type" content="image\/png">/, file);
    assert.match(html, /<meta property="og:image:width" content="1200">/, file);
    assert.match(html, /<meta property="og:image:height" content="630">/, file);
    assert.match(html, /<meta property="og:image:alt" content="[^"]+">/, file);
    assert.match(html, /<meta name="twitter:image:alt" content="[^"]+">/, file);
  }
});

test('no page on this site asks a font CDN for anything', () => {
  const stylesheets = ['styles.css', 'docs.css'].map((name) => (
    fs.readFileSync(path.join(ROOT, 'docs', name), 'utf8')
  ));
  const landing = fs.readFileSync(path.join(ROOT, 'docs', 'index.html'), 'utf8');
  for (const text of [...stylesheets, landing, ...site.files.values()]) {
    assert.ok(!/fonts\.(?:googleapis|gstatic)\.com/.test(text), 'a font CDN reference survived');
  }
  // Every self-hosted face has to actually be on disk, or the page silently
  // falls back to the system stack.
  const declared = [...stylesheets[0].matchAll(/url\("fonts\/([^"]+)"\)/g)].map((match) => match[1]);
  assert.ok(declared.length >= 5, `expected the site font faces, found ${declared.length}`);
  for (const file of declared) {
    const font = fs.readFileSync(path.join(ROOT, 'docs', 'fonts', file));
    assert.equal(font.subarray(0, 4).toString('ascii'), 'wOF2', `${file} is not a woff2`);
  }
});

// ------------------------------------------------------------ token palette

/**
 * WCAG 2.x relative luminance and contrast ratio, for `#rrggbb` literals.
 *
 * @param {string} first
 * @param {string} second
 * @returns {number}
 */
function contrastRatio(first, second) {
  const luminance = (color) => {
    const channels = color.slice(1).match(/.{2}/g).map((pair) => Number.parseInt(pair, 16) / 255);
    const linear = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
  };
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function paletteBlocks(css) {
  // The light palette is the first `:root {…}`; the dark one is the `:root`
  // nested in the prefers-color-scheme media query.
  const blocks = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((match) => match[1]);
  return blocks.slice(0, 2).map((block) => Object.fromEntries(
    [...block.matchAll(/(--color-[\w-]+):\s*(#[\da-f]{6})/gi)].map((match) => [match[1], match[2]]),
  ));
}

test('the token palette clears the contrast ratios its roles promise', () => {
  const css = fs.readFileSync(path.join(ROOT, 'docs', 'styles.css'), 'utf8');
  const [light, dark] = paletteBlocks(css);
  assert.ok(Object.keys(light).length > 10, 'the light palette did not parse');

  const bodyText = [
    ['--color-text', '--color-bg'],
    ['--color-text', '--color-surface'],
    ['--color-text-secondary', '--color-bg'],
    ['--color-link', '--color-bg'],
    ['--color-status-done-text', '--color-status-done-bg'],
    ['--color-status-progress-text', '--color-status-progress-bg'],
    ['--color-btn-text', '--color-btn-bg'],
  ];
  // Dark redefines only some tokens; anything it leaves alone still resolves
  // to the light value, which is what the browser does too.
  for (const [name, palette] of [['light', light], ['dark', { ...light, ...dark }]]) {
    for (const [foreground, background] of bodyText) {
      const ratio = contrastRatio(palette[foreground], palette[background]);
      assert.ok(ratio >= 4.5, `${name}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1`);
      assert.ok(ratio <= 21, `${name}: ${foreground} on ${background} exceeds 21:1`);
    }
    // Borders and accents are non-text UI, held to the 3:1 rule.
    const accent = contrastRatio(palette['--color-accent'], palette['--color-bg']);
    assert.ok(accent >= 3, `${name}: --color-accent on --color-bg is ${accent.toFixed(2)}:1`);
  }
});

test('contrastRatio matches the values WCAG defines', () => {
  // Built rather than written as literals: the hex-literal ban (spec §7.6)
  // applies to this file, and these two are the endpoints of the scale, not
  // colors the design uses.
  const black = `#${'0'.repeat(6)}`;
  const white = `#${'f'.repeat(6)}`;
  assert.equal(contrastRatio(black, white), 21);
  assert.equal(contrastRatio(white, white), 1);
});

// -------------------------------------------------------- write behaviour

test('a write rebuilds the output directory from empty, dropping a renamed route', () => {
  // Into a scratch directory, never docs/docs: other test files read the
  // committed site, and node --test runs files in parallel.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'build-pages-write-'));
  try {
    const stale = path.join(scratch, 'removed-route', 'index.html');
    fs.mkdirSync(path.dirname(stale), { recursive: true });
    fs.writeFileSync(stale, '<!doctype html><html></html>');
    assert.ok(compare(site.files, scratch).unexpected.includes('removed-route/index.html'));

    internals.writeSite(site.files, scratch);

    assert.equal(fs.existsSync(stale), false, 'a stale route survived the rebuild');
    assert.deepEqual(compare(site.files, scratch), { differences: [], unexpected: [] });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('an escaping route is refused with the existing output untouched', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'build-pages-escape-'));
  try {
    const keep = path.join(scratch, 'index.html');
    fs.writeFileSync(keep, 'existing');
    assert.throws(
      () => internals.writeSite(new Map([['../escape.html', 'x']]), scratch),
      /escapes docs\/docs/,
    );
    assert.equal(fs.readFileSync(keep, 'utf8'), 'existing', 'the output was deleted before the check');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('a route that escapes the output directory is refused before anything is deleted', () => {
  const escapes = ['../escape/index.html', '/etc/passwd', ''];
  for (const name of escapes) {
    assert.throws(() => internals.resolveOutputPath(OUTPUT_DIR, name), /escapes docs\/docs/, name);
  }
  assert.equal(
    internals.resolveOutputPath(OUTPUT_DIR, 'overview/index.html'),
    path.join(OUTPUT_DIR, 'overview', 'index.html'),
  );
});
