import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'generated') continue;
      sourceFiles(full, out);
      continue;
    }
    if (/\.(js|jsx)$/.test(name) && !/\.test\.(js|jsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe('dev server shared imports', () => {
  it('prebundles every shared entry the app imports', () => {
    const config = readFileSync(path.join(root, 'vite.config.js'), 'utf8');
    const included = new Set([...config.matchAll(/'(shared\/[^']+)'/g)].map((match) => match[1]));
    const imported = new Set();
    for (const file of sourceFiles(path.join(root, 'src'))) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/from 'shared\/([^']+)'/g)) imported.add(`shared/${match[1]}`);
    }
    expect([...imported].filter((id) => !included.has(id)).sort()).toEqual([]);
  });
});
