/** Preload the snapshot's heading, body and data faces; leave other faces lazy. */
export function criticalFontTags(css) {
  const families = new Set();
  for (const role of ['heading', 'body', 'data']) {
    const value = new RegExp(`--font-${role}:\\s*([^;]+);`).exec(css)?.[1];
    if (value && !value.trim().startsWith('var(')) {
      families.add(value.split(',')[0].trim().replace(/^['"]|['"]$/g, ''));
    }
  }
  const files = new Set();
  for (const [, block] of css.matchAll(/@font-face\s*\{([^}]+)\}/g)) {
    const family = /font-family:\s*['"]([^'"]+)['"]/.exec(block)?.[1];
    if (!families.has(family)) continue;
    const file = /url\(['"]?(\/fonts\/[a-z0-9-]+\.woff2)['"]?\)/.exec(block)?.[1];
    if (file) files.add(file);
  }
  return [...files].map((href) => ({ tag: 'link', injectTo: 'head',
    attrs: { rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: '', fetchpriority: 'low', href } }));
}
