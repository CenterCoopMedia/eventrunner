// The stored-mail preview document (issue #183). The frame that shows it is
// an empty sandbox; this document is the second barrier: a content policy
// that blocks every fetch and script, with every link made inert and the
// elements that could route around the sandbox or the policy removed first.
// Every assertion parses the output the way the frame will, rather than
// matching strings.
import { describe, expect, it } from 'vitest';
import { PREVIEW_POLICY, buildPreviewDoc, internals } from './emailPreview.js';

function parse(output) {
  return new DOMParser().parseFromString(output, 'text/html');
}

/** Every element in the parsed output, template contents included. */
function allElements(doc) {
  const found = [];
  const walk = (root) => {
    for (const element of root.querySelectorAll('*')) {
      found.push(element);
      if (element.localName === 'template' && element.content) walk(element.content);
    }
  };
  walk(doc);
  return found;
}

/** Every a or area in the output that still carries a link target. */
function liveLinks(doc) {
  return allElements(doc).filter(
    (element) =>
      (element.localName === 'a' || element.localName === 'area') &&
      [...element.attributes].some((attribute) => attribute.localName === 'href'),
  );
}

/**
 * The frame parses the output with the same algorithm DOMParser runs, so an
 * output that serializes back to itself is the tree the frame builds.
 */
function expectFixedPoint(output) {
  expect(internals.serialize(parse(output))).toBe(output);
}

describe('buildPreviewDoc', () => {
  it('puts the content policy first in <head>, word for word, then the colour scheme, the base and the style', () => {
    const output = buildPreviewDoc('<p>Hello.</p>');
    expect(output.startsWith('<!DOCTYPE html>')).toBe(true);
    const head = parse(output).head;
    const [policy, scheme, base, style] = head.children;

    expect(policy.tagName).toBe('META');
    expect(policy.getAttribute('http-equiv')).toBe('Content-Security-Policy');
    expect(policy.getAttribute('content')).toBe(
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'",
    );
    expect(PREVIEW_POLICY).toBe(policy.getAttribute('content'));

    expect(scheme.tagName).toBe('META');
    expect(scheme.getAttribute('name')).toBe('color-scheme');
    expect(scheme.getAttribute('content')).toBe('light');

    expect(base.tagName).toBe('BASE');
    expect(base.getAttribute('target')).toBe('_blank');
    expect(base.hasAttribute('href')).toBe(false);

    expect(style.tagName).toBe('STYLE');
    expect(style.textContent).toBe(':root{background:Canvas;color:CanvasText}');

    expect(parse(output).body.innerHTML).toBe('<p>Hello.</p>');
    expectFixedPoint(output);
  });

  it('removes every stored meta, base and link, keeps ours first, and turns every link into text', () => {
    const stored = [
      '<!DOCTYPE html><html><head>',
      '<meta charset="utf-8">',
      '<meta http-equiv="refresh" content="0; url=https://elsewhere.example.test/">',
      '<meta http-equiv="Content-Security-Policy" content="default-src *">',
      '<base href="https://elsewhere.example.test/">',
      '<link rel="preconnect" href="https://elsewhere.example.test">',
      '<link rel="stylesheet" href="https://elsewhere.example.test/mail.css">',
      '<title>Receipt</title>',
      '</head><body>',
      '<p><a href="https://elsewhere.example.test/read" target="_self">Read online</a></p>',
      '<map name="m"><area href="https://elsewhere.example.test/area" target="_top"></map>',
      '<svg><a href="https://elsewhere.example.test/svg"><text>Mark</text></a>',
      '<a xlink:href="https://elsewhere.example.test/xlink"><text>Old mark</text></a></svg>',
      '<math><mi href="https://elsewhere.example.test/math">x</mi></math>',
      '<meta http-equiv="refresh" content="1">',
      '</body></html>',
    ].join('');
    const output = buildPreviewDoc(stored);
    const doc = parse(output);

    // Only ours: the policy first, then the colour scheme.
    const metas = doc.querySelectorAll('meta');
    expect(metas).toHaveLength(2);
    expect(metas[0]).toBe(doc.head.firstElementChild);
    expect(metas[0].getAttribute('content')).toBe(PREVIEW_POLICY);

    const bases = doc.querySelectorAll('base');
    expect(bases).toHaveLength(1);
    expect(bases[0].hasAttribute('href')).toBe(false);
    expect(doc.querySelectorAll('link')).toHaveLength(0);
    expect(doc.title).toBe('Receipt');

    // The words stay; the link targets go.
    expect(doc.querySelector('p a').textContent).toBe('Read online');
    expect(doc.querySelectorAll('a')).toHaveLength(3);
    expect(doc.querySelectorAll('area')).toHaveLength(1);
    expect(liveLinks(doc)).toEqual([]);
    expect(output).not.toContain('elsewhere.example.test');
    expectFixedPoint(output);
  });

  it('removes SVG animation, so an animated target or href cannot bring a link back', () => {
    const payloads = [
      '<svg><a href="https://pixel.example.test/set"><set attributeName="target" to="_self"/><rect width="200" height="60"/></a></svg>',
      '<svg><a href="https://pixel.example.test/animate"><animate attributeName="target" values="_self" fill="freeze"/><rect width="200" height="60"/></a></svg>',
      '<svg><a id="lnk" href="https://pixel.example.test/outside"><rect width="200" height="60"/></a><set href="#lnk" attributeName="target" to="_self"/></svg>',
      '<svg><a id="bare"><rect width="200" height="60"/></a><set href="#bare" attributeName="href" to="https://pixel.example.test/animated-href"/></svg>',
      '<svg><a><animateMotion dur="1s" path="M0,0 L10,10"/><animateTransform attributeName="transform" type="scale" to="2"/><discard begin="0s"/><rect width="10" height="10"/></a></svg>',
    ];
    for (const payload of payloads) {
      const output = buildPreviewDoc(payload);
      const doc = parse(output);
      const names = allElements(doc).map((element) => element.localName);
      for (const name of ['set', 'animate', 'animateMotion', 'animateTransform', 'discard']) {
        expect(names, payload).not.toContain(name);
      }
      expect(liveLinks(doc), payload).toEqual([]);
      expect(output, payload).not.toContain('pixel.example.test');
      expect(doc.querySelector('rect'), payload).not.toBeNull();
      expectFixedPoint(output);
    }
  });

  it('removes every template, so a declarative shadow root the frame would attach never reaches it', () => {
    const payload = [
      '<p>Hello.</p>',
      '<div><template shadowrootmode="open">',
      '<a href="https://dsd-probe.example.test/clicked" target="_self">Read more</a>',
      '<link rel="dns-prefetch" href="https://dsd-probe.example.test">',
      '</template></div>',
      '<div><template shadowroot="open"><a href="https://dsd-probe.example.test/old">Old</a></template></div>',
    ].join('');
    const output = buildPreviewDoc(payload);
    expect(output).not.toContain('template');
    expect(output).not.toContain('dsd-probe.example.test');
    expect(parse(output).body.innerHTML).toBe('<p>Hello.</p><div></div><div></div>');
    expectFixedPoint(output);
  });

  it('removes forms, and settles markup that re-parses into a live link, or falls back to plain text', () => {
    const payload = [
      '<p>Hello</p><form><math><mtext></form><form><mglyph><style></math>',
      '<link rel="preconnect" href="https://tracker.example.test">',
      '<a id="nav" href="https://tracker.example.test/clicked" target="_self">Click</a>',
      '<base href="https://tracker.example.test/">',
      '</style></mglyph></form></mtext></math></form>',
    ].join('');
    const output = buildPreviewDoc(payload);
    if (output !== null) {
      const doc = parse(output);
      expect(doc.querySelectorAll('form, link')).toHaveLength(0);
      expect(doc.querySelectorAll('base')).toHaveLength(1);
      expect(liveLinks(doc)).toEqual([]);
      expect(output).not.toContain('tracker.example.test');
      expectFixedPoint(output);
    }
  });

  it('removes nested frames and embedded objects, whose srcdoc this pass would never read', () => {
    const payload = [
      '<p>Hello.</p>',
      '<iframe srcdoc="&lt;a href=&quot;https://frame.example.test/x&quot; target=&quot;_self&quot;&gt;x&lt;/a&gt;"></iframe>',
      '<object data="https://frame.example.test/o"></object><embed src="https://frame.example.test/e">',
    ].join('');
    const output = buildPreviewDoc(payload);
    expect(output).not.toContain('frame.example.test');
    expect(parse(output).querySelectorAll('iframe, object, embed')).toHaveLength(0);
  });

  it('writes a document that is its own fixed point, whatever the parser moved on the way', () => {
    for (const payload of [
      '<p>Hello.</p>',
      '<table><p>Moved</p><tr><td>Cell</td></tr></table>',
      '<svg><p>Breaks out</p></svg><math><mi>x</mi></math>',
      '<noscript><a href="https://x.example.test/">x</a></noscript>',
      '<p>A &amp; B &lt;tag&gt; “quoted”</p>',
    ]) {
      const output = buildPreviewDoc(payload);
      expect(output, payload).not.toBeNull();
      expectFixedPoint(output);
      expect(liveLinks(parse(output)), payload).toEqual([]);
    }
  });

  it('answers null, for the plain-text view, when the markup does not settle', () => {
    // One pass cannot confirm anything: the first parse of stored markup
    // never serializes back to the stored string with the doctype in front.
    expect(internals.settle('<p>Hello.</p>', { maxPasses: 1 })).toBeNull();
    expect(internals.settle('<p>Hello.</p>')).toBe('<!DOCTYPE html><html><head></head><body><p>Hello.</p></body></html>');
  });

  it('writes no colour literal of its own', () => {
    const output = buildPreviewDoc('<p>Hello.</p>');
    expect(output).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('parses without running anything and keeps the stored script for the frame to refuse', () => {
    // DOMParser builds an inert document: the script is data here, and the
    // sandbox and the policy are what refuse it in the frame.
    const output = buildPreviewDoc('<p id="probe">Script did not run.</p><script>document.title = "ran"</script>');
    const doc = parse(output);
    expect(doc.getElementById('probe').textContent).toBe('Script did not run.');
    expect(doc.querySelectorAll('script')).toHaveLength(1);
    expect(document.title).not.toBe('ran');
  });

  it('answers a document for an empty or missing body', () => {
    for (const html of ['', null, undefined]) {
      const doc = parse(buildPreviewDoc(html));
      expect(doc.head.firstElementChild.getAttribute('content')).toBe(PREVIEW_POLICY);
      expect(doc.body.textContent).toBe('');
    }
  });
});
