import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { expect, it } from 'vitest';

it('limits the derived white demo wordmark to screen media', () => {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.css');
  const root = postcss.parse(fs.readFileSync(file, 'utf8'), { from: file });
  const swaps = [];
  root.walkDecls('content', (declaration) => {
    if (declaration.value.includes('nclocal-logo-dark.svg')) swaps.push(declaration);
  });
  expect(swaps).toHaveLength(1);
  const rule = swaps[0].parent;
  expect(rule.selector).toContain('.demo-brand-artwork');
  expect(rule.selector).toContain('.historical-demo-logo');
  expect(rule.parent.type).toBe('atrule');
  expect(rule.parent.name).toBe('media');
  expect(rule.parent.params).toBe('screen');
});
