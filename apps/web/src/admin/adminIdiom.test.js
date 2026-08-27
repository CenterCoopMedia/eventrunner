// The room runs on the admin tokens and nothing else.
//
// The per-component tests assert this one rendered tree at a time, which
// leaves a gap: a page nobody wrote a token test for can quietly keep a
// `brand-*` utility and no suite notices. This test closes the gap by
// reading the source of the whole admin tree, so a new admin file is covered
// the moment it lands rather than when somebody remembers to assert it.
//
// The rule it enforces is the one from the admin story (part 5, "refuses the
// client's theme"): the admin has one fixed identity, so a client's palette,
// a client's faces, and a client's radius must never reach an admin-only
// surface. `admin-*` tokens only.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const { join } = path;
const ADMIN_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Every non-test source file under src/admin/, path relative to that dir. */
function adminSources(dir = ADMIN_DIR, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...adminSources(join(dir, entry.name), rel));
    } else if (/\.jsx?$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * A Tailwind utility built on a client-theme token. Anchored on the utility
 * prefix so the words "brand-new" in a comment are not a finding, and the
 * `--brand-*` custom properties a preset defines are not either.
 */
const CLIENT_COLOR_UTILITY =
  /\b(?:bg|text|border|border-[trblxyse]|ring|ring-offset|fill|stroke|from|via|to|divide|outline|decoration|placeholder|accent|caret|shadow)-brand-[a-z]/;

/** The client's radius, in both its steps. `rounded-admin` is the only one. */
const CLIENT_RADIUS_UTILITY = /\brounded-brand(?:-lg)?\b/;

/** The preset type roles. The room runs font-admin-ui and font-admin-data. */
const CLIENT_FONT_UTILITY = /\bfont-(?:heading|body|data|mono|sans|serif)\b/;

/** The tier-2 semantic colours. The room has its own `admin-state-*` set. */
const CLIENT_SEMANTIC_UTILITY =
  /\b(?:bg|text|border|border-[trblxyse]|ring|fill|stroke|divide|outline)-(?:success|warning|danger|highlight|keynote)\b/;

const RULES = [
  ['a client palette utility', CLIENT_COLOR_UTILITY],
  ['the client radius', CLIENT_RADIUS_UTILITY],
  ['a preset type role', CLIENT_FONT_UTILITY],
  ['a tier-2 semantic colour', CLIENT_SEMANTIC_UTILITY],
];

describe('the room runs on admin-* tokens only', () => {
  const files = adminSources();

  it('finds the admin sources to scan', () => {
    // A broken walk would make every assertion below pass vacuously.
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain('AdminLayout.jsx');
    expect(files).toContain('components/formControls.jsx');
  });

  it.each(RULES)('carries no %s', (_label, pattern) => {
    const offenders = [];
    for (const file of files) {
      const source = readFileSync(join(ADMIN_DIR, file), 'utf8');
      source.split('\n').forEach((line, index) => {
        if (pattern.test(line)) offenders.push(`${file}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('uses the two client-accent slots and never the raw accent', () => {
    // The accent appears in exactly two named places (admin story part 6f),
    // and both go through their own component token. A third reference is a
    // review failure, so it is a test failure.
    const raw = [];
    const slots = [];
    for (const file of files) {
      const source = readFileSync(join(ADMIN_DIR, file), 'utf8');
      if (/admin-client-accent/.test(source)) raw.push(file);
      if (/admin-nav-active-marker/.test(source)) slots.push(`${file}:nav`);
      if (/admin-page-header-mark/.test(source)) slots.push(`${file}:header`);
    }
    expect(raw).toEqual([]);
    expect(slots).toEqual(['AdminLayout.jsx:nav', 'components/adminChrome.jsx:header']);
  });
});
