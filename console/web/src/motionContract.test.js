import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { motionProblems } from '../../../scripts/lib/motion-contract.mjs';

const SRC = path.dirname(fileURLToPath(import.meta.url));
function stylesheets(dir = SRC) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'generated' || entry.name === 'test' ? [] : stylesheets(file);
    return entry.name.endsWith('.css') ? [file] : [];
  });
}

// Existing held-work artwork only. Exact selector/value pairs prevent a new
// loop on another surface from borrowing a mascot or spinner's exception.
const WAITING_LOOPS = new Map([
  ['.console-loading:not([data-loading-stage="initial"]) .console-spinner', 'console-spin var(--console-loading-cycle) linear infinite'],
  ['.build-step-dot', 'build-step-pulse 1.4s ease-in-out infinite alternate'],
  ['.wb-body', 'wb-bob 380ms ease-in-out infinite alternate'],
  ['.wb-shadow', 'wb-squash 380ms ease-in-out infinite alternate'],
  ['.wb-leg-a, .wb-arm-b', 'wb-swing 380ms ease-in-out infinite alternate'],
  ['.wb-leg-b, .wb-arm-a', 'wb-swing 380ms ease-in-out infinite alternate-reverse'],
  ['.wb-eyes', 'wb-blink 3.4s infinite'],
  ['.wb-strap', 'wb-sway 760ms ease-in-out infinite alternate'],
  ['.wb-confetti', 'wb-pop 1.9s ease-out infinite'],
]);
const waitingLoop = (decl) => path.relative(SRC, decl.source.input.file) === 'styles.css'
  && WAITING_LOOPS.get(decl.parent.selector) === decl.value;
const controlPaint = (decl) => path.relative(SRC, decl.source.input.file) === 'styles.css'
  && decl.parent.selector === '.button:not(.danger)';

describe('console motion contract', () => {
  it.each(stylesheets())('checks motion guards, loops and keyframes in %s', (file) => {
    const stylesheet = postcss.parse(fs.readFileSync(file, 'utf8'), { from: file });
    expect(motionProblems(stylesheet, waitingLoop, controlPaint)).toEqual([]);
  });

  it('rejects a new raw infinite animation in the console stylesheet', () => {
    const stylesheet = postcss.parse('.fixture { animation: x 1s infinite; }', { from: path.join(SRC, 'styles.css') });
    expect(motionProblems(stylesheet, waitingLoop)).toEqual([
      expect.stringContaining('motion preference:'), expect.stringContaining('ambient loop:'),
    ]);
  });

  it('rejects layout keyframes and a waiting loop outside its motion preference', () => {
    expect(motionProblems(postcss.parse('@keyframes x { to { height: 1px; } }')))
      .toEqual([expect.stringContaining('keyframe property:')]);
    const stylesheet = postcss.parse('.wb-body { animation: wb-bob 380ms ease-in-out infinite alternate; }', {
      from: path.join(SRC, 'styles.css'),
    });
    expect(motionProblems(stylesheet, waitingLoop)).toEqual([expect.stringContaining('motion preference:')]);
  });

  it('rejects layout and implicit transitions inside the motion preference', () => {
    for (const property of ['height', 'all', 'color']) {
      const stylesheet = postcss.parse(`@media (prefers-reduced-motion: no-preference) { .fixture { transition: ${property} 1s; } }`);
      expect(motionProblems(stylesheet)).toEqual([expect.stringContaining('transition property:')]);
    }
  });
});
