// Source-contract helpers shared by the public and isolated console tests.
export function inQuery(node, needle) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === 'atrule' && parent.name === 'media' && parent.params.includes(needle)) return true;
  }
  return false;
}

export const motionAllowed = (node) => inQuery(node, 'prefers-reduced-motion: no-preference');
export const motionReduced = (node) => inQuery(node, 'prefers-reduced-motion: reduce');
export const ANIMATABLE = new Set(['transform', 'opacity']);

export function place(node) {
  const file = node.source?.input.file ?? 'fixture';
  return `${file}:${node.source?.start?.line ?? 1} ${node.parent?.selector ?? node.parent?.name} { ${node.prop}: ${node.value} }`;
}

// A loop exception identifies an existing request-owned selector and its exact
// animation. It never exempts its motion preference or keyframe properties.
export function motionProblems(stylesheet, loopAllowed = () => false, paintAllowed = () => false) {
  const problems = [];
  stylesheet.walkDecls((decl) => {
    if (!/^(transition|animation)(-|$)/.test(decl.prop)) return;
    if (decl.value !== 'none' && !motionAllowed(decl)) problems.push(`motion preference: ${place(decl)}`);
    if (/^animation(?:-|$)/.test(decl.prop) && /\binfinite\b/.test(decl.value) && !loopAllowed(decl)) {
      problems.push(`ambient loop: ${place(decl)}`);
    }
    if (decl.prop === 'transition' || decl.prop === 'transition-property') {
      // Commas inside easing functions do not separate properties.
      const properties = decl.value.replace(/\([^)]*\)/g, '()').split(',');
      for (const part of properties) {
        const property = part.trim().split(/\s+/)[0];
        const controlPaint = ['background-color', 'border-color', 'color'].includes(property) && paintAllowed(decl);
        if (property !== 'none' && !ANIMATABLE.has(property) && !controlPaint) problems.push(`transition property: ${place(decl)}`);
      }
    }
  });
  stylesheet.walkAtRules(/^(?:-webkit-)?keyframes$/, (keyframes) => {
    keyframes.walkDecls((decl) => {
      if (!ANIMATABLE.has(decl.prop)) problems.push(`keyframe property: ${place(decl)}`);
    });
  });
  return problems;
}
