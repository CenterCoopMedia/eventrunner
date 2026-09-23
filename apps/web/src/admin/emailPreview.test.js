// The stored-mail preview document (issue #183). The frame that shows it is
// an empty sandbox; this document is the second barrier: a content policy
// that blocks every fetch and script, with the elements that could route
// around it removed first. Every assertion parses the output the way the
// frame will, rather than matching strings.
import { describe, expect, it } from 'vitest';
import { PREVIEW_POLICY, buildPreviewDoc } from './emailPreview.js';

function parse(output) {
  return new DOMParser().parseFromString(output, 'text/html');
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
  });

  it('removes a stored refresh, base and link, keeps ours first, and sends every link to a new tab', () => {
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
      '<svg><a href="https://elsewhere.example.test/svg"><text>Mark</text></a></svg>',
      '<meta http-equiv="refresh" content="1">',
      '</body></html>',
    ].join('');
    const doc = parse(buildPreviewDoc(stored));

    const policies = doc.querySelectorAll('meta[http-equiv]');
    expect(policies).toHaveLength(1);
    expect(policies[0]).toBe(doc.head.firstElementChild);
    expect(policies[0].getAttribute('content')).toBe(PREVIEW_POLICY);

    const bases = doc.querySelectorAll('base');
    expect(bases).toHaveLength(1);
    expect(bases[0].hasAttribute('href')).toBe(false);
    expect(doc.querySelectorAll('link')).toHaveLength(0);

    // The stored head's own harmless parts stay, after ours.
    expect(doc.head.children[4].tagName).toBe('META');
    expect(doc.head.children[4].getAttribute('charset')).toBe('utf-8');
    expect(doc.title).toBe('Receipt');

    expect(doc.querySelector('p a').getAttribute('target')).toBe('_blank');
    expect(doc.querySelector('area').getAttribute('target')).toBe('_blank');
    expect(doc.querySelector('svg a').getAttribute('target')).toBe('_blank');
  });

  it('writes no colour literal of its own', () => {
    const output = buildPreviewDoc('<p>Hello.</p>');
    expect(output).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('parses without running anything and keeps the stored markup for the frame to refuse', () => {
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
