const { readFileSync, writeFileSync } = require('node:fs');

function patch(path, replacements) {
  let source = readFileSync(path, 'utf8');
  for (const [before, after] of replacements) {
    const at = source.indexOf(before);
    if (at === -1 || at !== source.lastIndexOf(before)) {
      throw new Error(`Expected one match in ${path}: ${before}`);
    }
    source = source.replace(before, after);
  }
  writeFileSync(path, source);
}

// React requests paint after committing. Yield before the next scheduler
// callback so queued passive effects can land on a separate turn.
patch('node_modules/scheduler/cjs/scheduler.development.js', [
  ['var startTime = -1;', 'var startTime = -1;\nvar paintRequested = false;'],
  ['function shouldYieldToHost() {', 'function shouldYieldToHost() {\n  if (paintRequested) return true;'],
  ['function requestPaint() {\n\n}', 'function requestPaint() {\n  paintRequested = true;\n}'],
  ['    startTime = currentTime;\n    var hasTimeRemaining', '    startTime = currentTime;\n    paintRequested = false;\n    var hasTimeRemaining'],
]);

// Let a satisfied query resume before the next scheduler callback. Keep the
// library's normal timer handling when the test installs a fake clock.
patch('node_modules/@testing-library/react/dist/pure.js', [
  ['      await new Promise(resolve => {\n        setTimeout', [
    '      await new Promise(resolve => {',
    '        if (!jestFakeTimersAreEnabled() && !setTimeout.clock) {',
    '          queueMicrotask(resolve);',
    '          return;',
    '        }',
    '        setTimeout',
  ].join('\n')],
]);
