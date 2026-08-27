const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  DOCS_COLORS,
  DOCS_MANIFEST,
  buildPages,
  checkPages,
  contrastRatio,
  descriptionFromMarkdown,
  renderDocument,
  validateManifest,
  validateMarkdown,
  writePages,
} = require('./build-pages.cjs');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const PUBLIC_READER_ENTRY_SOURCES = [
  'README.md',
  'CONTRIBUTING.md',
  'SUPPORT.md',
  'docs/index.html',
  'docs/handbook/README.md',
  '.github/ISSUE_TEMPLATE/accessibility.yml',
  '.github/ISSUE_TEMPLATE/bug.yml',
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/ISSUE_TEMPLATE/docs.yml',
  '.github/ISSUE_TEMPLATE/feature.yml',
  '.github/DISCUSSION_TEMPLATE/general.yml',
  '.github/DISCUSSION_TEMPLATE/ideas.yml',
  '.github/DISCUSSION_TEMPLATE/q-a.yml',
  '.github/DISCUSSION_TEMPLATE/show-and-tell.yml',
];
const SOURCE_ONLY_DOCUMENTS = new Set([
  'docs/plans/2026-08-16-event-platform-v1-triage.md',
  'LICENSE',
  'NOTICE',
  '.env.example',
  'apps/web/README.md',
]);

function gitHubBlobSources(content) {
  const blobPattern = /https:\/\/github\.com\/CenterCoopMedia\/(?:eventrunner|run-of-show)\/blob\/[^/]+\/([^#)\s]+)/gi;
  return [...content.matchAll(blobPattern)].map((match) => match[1]);
}

test('the explicit manifest gives each public source one Eventrunner route', () => {
  const routes = new Map(DOCS_MANIFEST.map((document) => [document.source, document.route]));

  assert.equal(DOCS_MANIFEST.length, 22);
  assert.equal(routes.get('README.md'), '/eventrunner/docs/overview/');
  assert.equal(routes.get('docs/ADMIN_GUIDE.md'), '/eventrunner/docs/admin-guide/');
  assert.equal(routes.get('docs/handbook/README.md'), '/eventrunner/docs/handbook/');
  assert.equal(routes.get('docs/adr/0001-event-platform-v1.md'), '/eventrunner/docs/architecture/');
  assert.equal(routes.get('CHANGELOG.md'), '/eventrunner/docs/changelog/');
  assert.equal(new Set(routes.values()).size, DOCS_MANIFEST.length);
  assert.equal(
    DOCS_MANIFEST.every((document) => document.route.startsWith('/eventrunner/docs/') && document.route.endsWith('/')),
    true,
  );
});

test('public reader entry sources use Pages routes for manifest documents, not GitHub blobs', () => {
  const manifestSources = new Set(DOCS_MANIFEST.map((document) => document.source));
  const sourceOnlyManifestCollisions = [...SOURCE_ONLY_DOCUMENTS].filter((source) => manifestSources.has(source));

  assert.deepEqual(sourceOnlyManifestCollisions, [], 'source-only documents must never gain generated Pages routes');

  for (const source of PUBLIC_READER_ENTRY_SOURCES) {
    const content = fs.readFileSync(path.join(REPOSITORY_ROOT, source), 'utf8');
    const manifestBlobs = gitHubBlobSources(content).filter((target) => manifestSources.has(target));

    assert.deepEqual(manifestBlobs, [], `${source} links a manifest document through a raw GitHub blob URL`);
  }
});

test('the documentation issue template sends handbook readers to Pages', () => {
  const template = fs.readFileSync(path.join(REPOSITORY_ROOT, '.github/ISSUE_TEMPLATE/docs.yml'), 'utf8');

  assert.doesNotMatch(template, /https:\/\/github\.com\/CenterCoopMedia\/eventrunner\/wiki/i);
  assert.doesNotMatch(template, /^\s*- Wiki \(attendee \/ staff \/ client handbook\)$/m);
});

test('a document gets the shared semantic shell, metadata, navigation, and a stable table of contents', () => {
  const manifest = [
    { source: 'README.md', route: '/eventrunner/docs/overview/', title: 'Eventrunner overview', section: 'Product' },
    { source: 'docs/ADMIN_GUIDE.md', route: '/eventrunner/docs/admin-guide/', title: 'Admin guide', section: 'Operators' },
  ];
  const markdown = [
    '# Eventrunner overview',
    '',
    'A practical guide for event staff.',
    '',
    '## Start here',
    '',
    'Read the [admin guide](docs/ADMIN_GUIDE.md#Inviting-staff).',
    '',
    '### Inviting staff',
    '',
    'Invite the people who need access.',
  ].join('\n');

  const html = renderDocument({ document: manifest[0], markdown, manifest, previous: null, next: manifest[1] });

  assert.match(html, /<a class="skip-link" href="#main">Skip to content<\/a>/);
  assert.match(html, /<nav[^>]+aria-label="Breadcrumb">/);
  assert.match(html, /<aside class="section-nav">/);
  assert.match(html, /<nav[^>]+aria-label="On this page">/);
  assert.match(html, /<h1 id="eventrunner-overview">Eventrunner overview<\/h1>/);
  assert.match(html, /<h2 id="start-here">Start here<\/h2>/);
  assert.match(html, /href="\/eventrunner\/docs\/admin-guide\/#inviting-staff"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/centercoopmedia\.github\.io\/eventrunner\/docs\/overview\/">/);
  assert.match(html, /<meta name="description" content="A practical guide for event staff\.">/);
  assert.match(html, /<meta property="og:title" content="Eventrunner overview \| Eventrunner">/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(html, /<meta property="og:image:type" content="image\/png">/);
  assert.match(html, /<meta property="og:image:width" content="1200">/);
  assert.match(html, /<meta property="og:image:height" content="630">/);
  assert.match(html, /<meta property="og:image:alt" content="Eventrunner documentation">/);
  assert.match(html, /<meta name="twitter:image:alt" content="Eventrunner documentation">/);
  assert.match(html, /<meta name="theme-color" content="#114b8b">/);
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/eventrunner\/docs\/assets\/favicon\.svg">/);
  assert.match(html, /<a rel="next" href="\/eventrunner\/docs\/admin-guide\/">Admin guide<\/a>/);
});

test('the renderer escapes raw HTML, retains literal templates, and rewrites safe Markdown and blob links', () => {
  const manifest = [
    { source: 'README.md', route: '/eventrunner/docs/overview/', title: 'Eventrunner overview', section: 'Product' },
    { source: 'docs/ADMIN_GUIDE.md', route: '/eventrunner/docs/admin-guide/', title: 'Admin guide', section: 'Operators' },
  ];
  const markdown = [
    '# Eventrunner overview',
    '',
    '<script>alert("not executable")</script>',
    '',
    'Keep `{{ value }}` and `${{ github.ref }}` literal.',
    '',
    '[Unsafe](javascript:alert(1)) [Data](data:text/plain,unsafe) [VBScript](vbscript:msgbox(1)) [Protocol-relative](//example.test/) [Markdown](docs/ADMIN_GUIDE.md#Staff-access)',
    '',
    '[Blob](https://github.com/CenterCoopMedia/run-of-show/blob/main/docs/ADMIN_GUIDE.md#Staff-access)',
    '',
    '![Unsafe](javascript:alert(1)) ![Data](data:image/png;base64,AAAA) ![VBScript](vbscript:msgbox(1))',
    '',
    '![Safe <alt>](https://example.test/safe.png "A <title>") ![Local](/eventrunner/docs/assets/og-default.png)',
  ].join('\n');

  const html = renderDocument({ document: manifest[0], markdown, manifest, previous: null, next: null });

  assert.match(html, /&lt;script&gt;alert\(&quot;not executable&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /href="(?:javascript|data|vbscript):|href="\/\//i);
  assert.doesNotMatch(html, /<img[^>]+src="(?:javascript|data|vbscript):/i);
  assert.match(html, /<img src="https:\/\/example\.test\/safe\.png" alt="Safe &lt;alt&gt;" title="A &lt;title&gt;">/);
  assert.match(html, /<img src="\/eventrunner\/docs\/assets\/og-default\.png" alt="Local">/);
  assert.match(html, /\{\{ value \}\}/);
  assert.match(html, /\$\{\{ github\.ref \}\}/);
  assert.equal((html.match(/href="\/eventrunner\/docs\/admin-guide\/#staff-access"/g) || []).length, 2);
});

test('real source documents keep reader and source links usable across GitHub and Pages', () => {
  const contributing = DOCS_MANIFEST.find((document) => document.source === 'CONTRIBUTING.md');
  const postmark = DOCS_MANIFEST.find((document) => document.source === 'docs/POSTMARK_PROVISIONING.md');
  const contributingMarkdown = fs.readFileSync(path.join(REPOSITORY_ROOT, contributing.source), 'utf8');
  const postmarkMarkdown = fs.readFileSync(path.join(REPOSITORY_ROOT, postmark.source), 'utf8');
  const contributingHtml = renderDocument({ document: contributing, markdown: contributingMarkdown, previous: null, next: null });
  const postmarkHtml = renderDocument({ document: postmark, markdown: postmarkMarkdown, previous: null, next: null });

  assert.match(contributingHtml, /href="https:\/\/centercoopmedia\.github\.io\/eventrunner\/docs\/roadmap\/"/);
  assert.match(contributingHtml, /href="https:\/\/github\.com\/CenterCoopMedia\/eventrunner\/blob\/main\/apps\/web\/README\.md"/);
  assert.match(postmarkHtml, /href="\/eventrunner\/docs\/client-onboarding\/"/);
});

test('the complete manifest builds the hub, document routes, and documentation assets', () => {
  const pages = buildPages({ root: path.resolve(__dirname, '..') });

  assert.equal(pages.size, DOCS_MANIFEST.length + 5);
  assert.match(pages.get('index.html'), /<h1>Eventrunner documentation<\/h1>/);
  assert.match(pages.get('admin-guide/index.html'), /<title>Admin guide \| Eventrunner<\/title>/);
  assert.match(pages.get('handbook/for-attendees/index.html'), /<main id="main">/);
  assert.match(pages.get('assets/docs.css'), /Source Sans 3/);
  assert.doesNotMatch(pages.get('assets/docs.css'), /Source Serif/i);
  assert.match(pages.get('assets/docs.css'), /ui-monospace/);
  assert.doesNotMatch(pages.get('assets/docs.css'), /@import|fonts\.googleapis\.com/i);
  assert.equal(Buffer.isBuffer(pages.get('assets/source-sans-3-latin.woff2')), true);
  assert.match(pages.get('assets/favicon.svg'), /<svg/);
  const preview = pages.get('assets/og-default.png');
  assert.equal(Buffer.isBuffer(preview), true);
  assert.deepEqual(preview.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(preview.readUInt32BE(16), 1200);
  assert.equal(preview.readUInt32BE(20), 630);
  for (const [file, content] of pages) {
    if (!file.endsWith('.html')) continue;
    assert.match(content, /<meta property="og:image:alt" content="Eventrunner documentation">/);
    assert.match(content, /<meta name="twitter:image:alt" content="Eventrunner documentation">/);
  }
});

test('documentation styles wrap inline code and links while keeping code blocks scrollable', () => {
  const pages = buildPages({ root: path.resolve(__dirname, '..') });
  const stylesheet = pages.get('assets/docs.css');

  assert.match(stylesheet, /\.document-content \{[^}]*min-width:\s*0;[^}]*\}/s);
  assert.match(stylesheet, /\.document-content a, \.document-content :not\(pre\) > code \{[^}]*overflow-wrap:\s*anywhere;[^}]*\}/s);
  assert.match(stylesheet, /\.document-content pre \{[^}]*max-width:\s*100%;[^}]*overflow-x:\s*auto;[^}]*\}/s);
});

test('the generated Postmark provisioning page uses the current Eventrunner example', () => {
  const pages = buildPages({ root: path.resolve(__dirname, '..') });
  const postmarkPage = pages.get('postmark-provisioning/index.html');

  assert.doesNotMatch(postmarkPage, /runofshow\.net|events@runofshow\.net|runofshow-dev/i);
});

test('generated public documentation excludes private operator details and keeps public mail guidance valid', () => {
  const pages = buildPages({ root: path.resolve(__dirname, '..') });
  const generatedHtml = [...pages.entries()]
    .filter(([file]) => file.endsWith('.html'))
    .map(([, content]) => content)
    .join('\n');
  const postmarkPage = pages.get('postmark-provisioning/index.html');
  const securityPage = pages.get('security/index.html');

  assert.doesNotMatch(generatedHtml, /amditisj@montclair\.edu/i);
  assert.doesNotMatch(generatedHtml, /info@collaborativejournalism\.org/i);
  assert.match(postmarkPage, /v=DMARC1; p=none; rua=mailto:info@eventrunner\.org/);
  assert.doesNotMatch(securityPage, /OPERATOR NOTE|info@collaborativejournalism\.org/i);
  assert.match(securityPage, /info@eventrunner\.org/);
});

test('descriptions truncate at a word boundary and use an escaped fallback', () => {
  const markdown = `# Guide\n\n${'Useful guidance '.repeat(14)}final words.`;
  const description = descriptionFromMarkdown(markdown, 'Fallback description');
  const fallback = descriptionFromMarkdown('# Guide', 'Fallback <description>');
  const unbrokenDescription = descriptionFromMarkdown(`# Guide\n\n${'x'.repeat(161)}`, 'Fallback description');
  const html = renderDocument({
    document: { source: 'README.md', route: '/eventrunner/docs/overview/', title: 'Guide <fallback>', section: 'Product' },
    markdown: '# Guide',
    manifest: [{ source: 'README.md', route: '/eventrunner/docs/overview/', title: 'Guide <fallback>', section: 'Product' }],
    previous: null,
    next: null,
  });

  assert.ok(description.length <= 160);
  assert.doesNotMatch(description, /\s$/);
  assert.equal(description.endsWith('guidance'), true);
  assert.equal(fallback, 'Fallback <description>');
  assert.equal(unbrokenDescription, 'Fallback description');
  assert.match(html, /<meta name="description" content="Guide &lt;fallback&gt;">/);
});

test('focus contrast stays within the accessible contrast range', () => {
  const ratio = contrastRatio(DOCS_COLORS.focus, DOCS_COLORS.paper);

  assert.ok(ratio >= 3, `focus outline contrast was ${ratio}`);
  assert.ok(ratio <= 21, `contrast ratio cannot exceed 21:1; received ${ratio}`);
});

test('manifest and Markdown validation reject sources and structures that cannot publish safely', () => {
  assert.throws(
    () => validateManifest([
      { source: 'README.md', route: '/eventrunner/docs/overview/', title: 'Overview', section: 'Product' },
      { source: 'README.md', route: '/eventrunner/docs/other/', title: 'Other', section: 'Product' },
    ]),
    /duplicate source/i,
  );
  assert.throws(
    () => validateManifest([
      { source: 'README.md', route: '/eventrunner/docs/../escape/', title: 'Overview', section: 'Product' },
    ]),
    /route/i,
  );
  assert.throws(
    () => validateManifest([
      { source: 'README.md', route: '/eventrunner/docs/a//b/', title: 'One', section: 'Product' },
      { source: 'docs/README.md', route: '/eventrunner/docs/a/b/', title: 'Two', section: 'Product' },
    ]),
    /output/i,
  );
  assert.throws(
    () => validateMarkdown('# Overview\n\n### Skipped level', 'README.md'),
    /skips from h1 to h3/i,
  );
  assert.throws(
    () => validateMarkdown('# One\n\n# Two', 'README.md'),
    /exactly one h1/i,
  );
  assert.throws(
    () => buildPages({
      root: path.resolve(__dirname, '..'),
      manifest: [{ source: 'docs/missing.md', route: '/eventrunner/docs/missing/', title: 'Missing', section: 'Product' }],
    }),
    /source file/i,
  );
});

test('the generated tree is fresh, self-contained, and rejects stale output', () => {
  const pages = buildPages({ root: path.resolve(__dirname, '..') });
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'eventrunner-pages-'));

  try {
    writePages({ root: temporaryRoot, pages });
    assert.doesNotThrow(() => checkPages({ root: temporaryRoot, pages }));

    const stalePage = path.join(temporaryRoot, 'docs', 'docs', 'overview', 'index.html');
    fs.appendFileSync(stalePage, '\n<!-- stale -->\n');
    assert.throws(() => checkPages({ root: temporaryRoot, pages }), /stale generated documentation/i);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('generated pages never retain raw Markdown or legacy Pages links for public documents', () => {
  const pages = buildPages({ root: path.resolve(__dirname, '..') });
  const generatedHtml = [...pages.entries()]
    .filter(([file]) => file.endsWith('.html'))
    .map(([, content]) => content)
    .join('\n');

  assert.doesNotMatch(generatedHtml, /href="(?:\.\/|\.\.\/|docs\/)[^"]+\.md(?:#|")/i);
  assert.doesNotMatch(generatedHtml, /github\.com\/CenterCoopMedia\/(?:eventrunner|run-of-show)\/blob\/[^/]+\/docs\/ADMIN_GUIDE\.md/i);
  assert.doesNotMatch(generatedHtml, /centercoopmedia\.github\.io\/run-of-show\//i);
});
