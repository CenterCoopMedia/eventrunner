'use strict';

/**
 * The token generator (design brief 2026-08-27, §3.5 and §3.6).
 *
 * Reads the JSON under `design/tokens/` — the one source of truth for the
 * design system — and writes the CSS custom properties that
 * `apps/web/src/generated/theme.css` carries. `scripts/lib/emit.cjs` calls
 * `buildTokenCss()`; nothing else in the repo mints a token.
 *
 * The chain this sits in (brief §3.6):
 *
 *   design/tokens/*.json
 *      → scripts/lib/tokens.cjs        (this file)
 *      → config/theme                  (Firestore: preset, palette, fonts,
 *                                       options, overrides, motif set, mode)
 *      → generated/theme.css           (build-time custom properties)
 *      → <style id="event-theme-runtime">   (runtime override)
 *      → data-theme + data-mode + data-motif-set on <html>
 *      → tailwind.config.js maps utilities to var(--…)
 *
 * Three rules bind every value this file writes:
 *
 *   1. Colors stay space-separated RGB triples, so Tailwind's
 *      `rgb(var(--…-rgb) / <alpha-value>)` utilities keep their opacity
 *      modifiers working (spec §7.2).
 *   2. No hex literal appears in this source. `scripts/**` is not on the
 *      spec §7.6 allowlist, so every channel arrives as a number — from
 *      the token JSON (data, not linted source) or from `config/theme`.
 *   3. Every resolution of `config/theme` down to a palette, a type map, or
 *      an option pick runs through `packages/shared/src/theme.cjs`. That is
 *      the ONE resolver (brief §5.2), shared with the browser runtime and
 *      the publish path.
 *
 * WHICH FONTS SHIP. Brief §4: "A deployed site loads only the faces its
 * active preset and its picked options use. The bundle lives in the repo. It
 * never lands on a reader in full." That is a statement about DOWNLOADS, and
 * a downloaded face is not the same thing as a declared one.
 *
 * An `@font-face` block is lazy by specification: the browser fetches the
 * file only once a rendered element resolves to that family. Declaring a
 * family nothing renders costs the CSS bytes of the block and not one
 * request. So the declarations here cover EVERY bundled set — the whole of
 * `FONT_SETS` — plus the two fixed admin faces, which every deployment ships
 * because the admin identity is not configurable (admin story part 6g).
 *
 * The reason it has to be every set is that the type map is LIVE. A stored
 * `config/theme` is not the only thing that picks faces:
 *
 *   - `config/theme` arrives over `onSnapshot`, so an operator publishing a
 *     new preset restyles an open page without a rebuild;
 *   - a picked heading-face option remaps `--font-heading` the same way;
 *   - `config/theme.fonts` may name ANY id in `THEME_FONT_SET_IDS` outright;
 *   - the admin's theme preview renders a candidate document inside a frame.
 *
 * All four run through `buildRuntimeThemeCss`, which writes a `--font-*`
 * stack — and a stack naming a family with no `@font-face` block renders the
 * fallback. Emitting only the build-time preset's faces meant every one of
 * those switches silently degraded to Georgia. `themeRuntime.js` says it
 * outright: "the runtime override only swaps which family a role resolves
 * to, it never introduces a remote font" — which holds only if the families
 * it can swap to are all declared here.
 *
 * Switching `data-theme` at runtime swaps the PALETTE, which is what the
 * dark-mode completeness test walks; the type map, the shape, and the faces
 * follow the resolved document through this generator and through
 * `buildRuntimeThemeCss`.
 */

const fs = require('node:fs');
const path = require('node:path');

const {
  THEME_FONT_ROLES,
  THEME_MODES,
  THEME_MODE_POLICIES,
  THEME_PRESET_IDS,
  DEFAULT_MODE_POLICY,
  deriveRuleColors,
  getPreset,
  themePresetId,
  resolveAdminAccent,
  resolveComponentFonts,
  resolveFontRoles,
  resolveMotifSet,
  resolvePresetTokens,
  resolveShape,
  resolveThemePalettes,
  isRgb,
} = require('shared/theme');
const { FONT_SETS, RADIUS_SCALES } = require('./theme.cjs');

const TOKENS_DIR = path.resolve(__dirname, '..', '..', 'design', 'tokens');

/** The five token files, in tier order. */
const TOKEN_FILES = Object.freeze({
  primitives: 'primitives.json',
  semantic: 'semantic.json',
  components: 'components.json',
  motifs: 'motifs.json',
  admin: 'admin.json',
});

/** Tier 1 property prefix (brief §3.1: `--er-<family>-<step>`). */
const PRIMITIVE_PREFIX = '--er';


/**
 * Read the token JSON. A file that is missing or unparseable fails the
 * build by name (brief §3.5) rather than producing a stylesheet with a
 * silently empty tier.
 *
 * @param {string} [dir] token directory, for tests
 * @returns {{ primitives: object, semantic: object, components: object,
 *             motifs: object, admin: object }}
 */
function loadTokens(dir = TOKENS_DIR) {
  const loaded = {};
  for (const [key, file] of Object.entries(TOKEN_FILES)) {
    const target = path.join(dir, file);
    let raw;
    try {
      raw = fs.readFileSync(target, 'utf8');
    } catch (err) {
      throw new Error(`design token file ${file} could not be read: ${err.message}`);
    }
    try {
      loaded[key] = JSON.parse(raw);
    } catch (err) {
      throw new Error(`design token file ${file} is not valid JSON: ${err.message}`);
    }
  }
  return loaded;
}

/** A `$`-prefixed key is a note for a human reader, never a token. */
function tokenEntries(obj) {
  return Object.entries(obj || {}).filter(([key]) => !key.startsWith('$'));
}

/** @param {readonly number[]} rgb @returns {string} `r g b` */
function triple(rgb) {
  return rgb.join(' ');
}

/**
 * @param {object} primitives primitives.json
 * @param {string} ref `family.step`
 * @returns {number[]|null}
 */
function primitiveColor(primitives, ref) {
  const [family, step] = String(ref).split('.');
  const rgb = primitives?.color?.[family]?.[step];
  return isRgb(rgb) ? rgb : null;
}

/**
 * Resolve every tier 2 and tier 3 color token, for both modes, from one
 * pair of palettes.
 *
 * @param {{ light: Record<string, number[]>, dark: Record<string, number[]> }} palettes
 * @param {object} tokens loadTokens() result
 * @returns {{ names: string[], values: Record<string, Record<string, string>> }}
 *   `values[mode][token]` is the CSS value to write.
 */
function colorTokensFromPalettes(palettes, tokens) {
  const rules = {};
  for (const mode of THEME_MODES) {
    const { ink, surface } = palettes[mode];
    rules[mode] = isRgb(ink) && isRgb(surface) ? deriveRuleColors({ ink, surface }) : {};
  }

  const names = [];
  const values = { light: {}, dark: {} };
  const emitted = new Set();

  const record = (name, perMode) => {
    names.push(name);
    emitted.add(name);
    for (const mode of THEME_MODES) values[mode][name] = perMode[mode];
  };

  for (const [name, spec] of tokenEntries(tokens.semantic.color)) {
    if (spec.themeKey) {
      if (!isRgb(palettes.light[spec.themeKey]) || !isRgb(palettes.dark[spec.themeKey])) continue;
      record(name, {
        light: triple(palettes.light[spec.themeKey]),
        dark: triple(palettes.dark[spec.themeKey]),
      });
    } else if (spec.rule) {
      if (!isRgb(rules.light[spec.rule]) || !isRgb(rules.dark[spec.rule])) continue;
      record(name, { light: triple(rules.light[spec.rule]), dark: triple(rules.dark[spec.rule]) });
    } else if (spec.alias) {
      if (!emitted.has(spec.alias)) continue;
      record(name, { light: `var(${spec.alias})`, dark: `var(${spec.alias})` });
    } else if (spec.primitive) {
      const rgb = primitiveColor(tokens.primitives, spec.primitive);
      if (!rgb) continue;
      record(name, { light: triple(rgb), dark: triple(rgb) });
    }
  }

  // Tier 3 colors are contracts over tier 2, so they ride in the mode
  // blocks too. A component that reads one gets the mode's value without
  // knowing the mode exists (brief §3.1).
  for (const [, contract] of tokenEntries(tokens.components)) {
    for (const [name, target] of tokenEntries(contract)) {
      if (!name.endsWith('-rgb')) continue;
      if (!emitted.has(target)) continue;
      record(name, { light: `var(${target})`, dark: `var(${target})` });
    }
  }

  return { names, values };
}

/**
 * The color tokens for one `config/theme` document — its preset, its stored
 * palette, and its per-mode overrides, resolved through the shared resolver.
 *
 * @param {object} theme config/theme
 * @param {object} tokens loadTokens() result
 */
function resolveColorTokens(theme, tokens) {
  return colorTokensFromPalettes(resolveThemePalettes(theme), tokens);
}

/**
 * The `admin-*` color tokens, per mode (admin story part 6).
 *
 * The client accent is the only client-owned value in the set, and it
 * carries a legibility floor: when the resolved accent fails 3:1 against
 * `--admin-ground` in a mode, that mode falls back to `--admin-ink`. The
 * fallback is per mode, because an accent can read on one ground and not on
 * the other.
 *
 * @param {object} theme config/theme
 * @param {object} tokens loadTokens() result
 * @returns {{ names: string[], values: Record<string, Record<string, string>> }}
 */
function resolveAdminTokens(theme, tokens) {
  const admin = tokens.admin;
  const names = [];
  const values = { light: {}, dark: {} };

  for (const [name, spec] of tokenEntries(admin.colors)) {
    if (!isRgb(spec.light) || !isRgb(spec.dark)) continue;
    names.push(name);
    values.light[name] = triple(spec.light);
    values.dark[name] = triple(spec.dark);
  }

  for (const [name, target] of tokenEntries(admin.aliases)) {
    names.push(name);
    for (const mode of THEME_MODES) {
      const accent = resolveAdminAccent(theme, mode);
      values[mode][name] = accent.rgb ? triple(accent.rgb) : `var(${target})`;
    }
  }

  for (const [name, target] of tokenEntries(admin.components)) {
    names.push(name);
    for (const mode of THEME_MODES) values[mode][name] = `var(${target})`;
  }

  return { names, values };
}

/**
 * The font stacks each role resolves to, and the faces those stacks need.
 *
 * A role nothing names is NOT resolved here. It falls through to the alias
 * list in `semantic.json` instead — `--font-data` follows `--font-body`,
 * `--font-mono` follows `--font-data` — so a deployment made before the data
 * and mono roles existed still resolves every role.
 *
 * @param {object} theme
 * @returns {{ stacks: Record<string, string>,
 *             componentStacks: Record<string, string>,
 *             faces: Array<{family: string, file: string, weight: string}> }}
 */
function resolveFonts(theme) {
  const stacks = {};
  const componentStacks = {};
  const faces = [];
  const seenFiles = new Set();

  const take = (setId) => {
    const set = FONT_SETS[setId];
    if (!set) return null;
    for (const face of set.faces || []) {
      if (seenFiles.has(face.file)) continue;
      seenFiles.add(face.file);
      faces.push({ family: set.family, file: face.file, weight: face.weight });
    }
    return set.stack;
  };

  const roles = resolveFontRoles(theme);
  for (const role of THEME_FONT_ROLES) {
    if (!roles[role]) continue;
    const stack = take(roles[role]);
    if (stack) stacks[role] = stack;
  }

  for (const [name, setId] of Object.entries(resolveComponentFonts(theme))) {
    const stack = take(setId);
    if (stack) componentStacks[name] = stack;
  }

  return { stacks, componentStacks, faces };
}

/**
 * Every bundled face a running deployment can reach.
 *
 * The union of `FONT_SETS`, because `buildRuntimeThemeCss` can resolve a
 * role to any of them — through a published preset change, a picked
 * heading-face option, a `config/theme.fonts` role named outright, or the
 * admin's live theme preview. A declaration is lazy, so the browser fetches
 * only the families a rendered element actually resolves to; what this list
 * decides is which families CAN be resolved at all, not what downloads.
 *
 * @returns {Array<{family: string, file: string, weight: string}>}
 */
function resolveSelectableFaces() {
  const faces = [];
  const seenFiles = new Set();
  for (const set of Object.values(FONT_SETS)) {
    for (const face of set.faces || []) {
      if (seenFiles.has(face.file)) continue;
      seenFiles.add(face.file);
      faces.push({ family: set.family, file: face.file, weight: face.weight });
    }
  }
  return faces;
}

/**
 * The two fixed admin faces. They ship on every deployment, whatever preset
 * the client runs, because `--admin-font-*` is never writable from
 * `config/theme` (admin story part 6g).
 *
 * @param {object} tokens loadTokens() result
 * @returns {{ stacks: Record<string, string>,
 *             faces: Array<{family: string, file: string, weight: string}> }}
 */
function resolveAdminFonts(tokens) {
  const stacks = {};
  const faces = [];
  for (const [name, setId] of tokenEntries(tokens.admin.fonts)) {
    const set = FONT_SETS[setId];
    if (!set) continue;
    stacks[name] = set.stack;
    for (const face of set.faces || []) {
      faces.push({ family: set.family, file: face.file, weight: face.weight });
    }
  }
  return { stacks, faces };
}

/** The mode policy this document asks for (brief §3.3). */
function modePolicy(theme) {
  return THEME_MODE_POLICIES.includes(theme?.mode) ? theme.mode : DEFAULT_MODE_POLICY;
}

/**
 * One motif set's slot values (brief §3.8). A slot the set leaves empty
 * resolves to `none`, so a component's mask-image simply paints nothing.
 *
 * @param {object} motifs motifs.json
 * @param {string} setId
 * @returns {Array<[string, string]>} property, value
 */
function motifSlotValues(motifs, setId) {
  const set = motifs.sets?.[setId];
  const lines = [['--motif-set', setId]];
  for (const slot of motifs.slots || []) {
    const asset = set?.slots?.[slot];
    lines.push([
      `--motif-${slot}`,
      asset && set.assetDir ? `url('/motifs/${set.assetDir}/${asset}')` : 'none',
    ]);
  }
  return lines;
}

/**
 * The `:root` block: every token that does not change with the mode.
 *
 * @param {object} theme
 * @param {object} tokens
 * @returns {string[]} CSS lines
 */
function rootBlock(theme, tokens) {
  const lines = [];
  const push = (name, value) => lines.push(`  ${name}: ${value};`);
  const group = (comment) => {
    if (lines.length > 0) lines.push('');
    lines.push(`  /* ${comment} */`);
  };

  group('Tier 1 — primitives (brief §3.1). Raw values. Tier 2 reads these.');
  for (const [family, steps] of tokenEntries(tokens.primitives.color)) {
    for (const [step, rgb] of tokenEntries(steps)) {
      if (isRgb(rgb)) push(`${PRIMITIVE_PREFIX}-${family}-${step}`, triple(rgb));
    }
  }
  for (const [family, steps] of tokenEntries(tokens.primitives.scalar)) {
    for (const [step, value] of tokenEntries(steps)) {
      push(`${PRIMITIVE_PREFIX}-${family}-${step}`, value);
    }
  }

  group('Tier 2 — fluid type scale (brief §3.7). Eight steps, size + line height + tracking.');
  for (const [step, spec] of tokenEntries(tokens.semantic.text)) {
    push(`--text-${step}`, spec.size);
    push(`--text-${step}-leading`, spec.leading);
    push(`--text-${step}-tracking`, spec.tracking);
  }

  group('Tier 2 — spacing scale (brief §3.7).');
  for (const [step, value] of tokenEntries(tokens.semantic.space)) push(`--space-${step}`, value);

  group('Tier 2 — rule widths (brief §3.7). The matching colors are mode-scoped below.');
  for (const [weight, spec] of tokenEntries(tokens.semantic.rule)) {
    push(`--rule-${weight}-width`, spec.width);
  }

  const presetId = themePresetId(theme);
  const preset = getPreset(presetId);
  const { stacks, componentStacks } = resolveFonts(theme);
  group(
    'Tier 2 — font roles (brief §3.2). The active preset\'s type map, then its ' +
    'picked heading-face option, then any role config/theme.fonts names ' +
    'outright — all resolved to a bundled set id (spec §7.4).' +
    (preset ? ` Preset: ${preset.id}.` : ' No preset: config/theme.fonts only.'),
  );
  for (const role of THEME_FONT_ROLES) {
    if (stacks[role]) push(`--font-${role}`, stacks[role]);
  }
  for (const [name, value] of tokenEntries(tokens.semantic.font)) {
    const role = name.replace(/^--font-/, '');
    if (stacks[role]) continue;
    push(name, value);
  }

  const shape = resolveShape(theme);
  const radius = RADIUS_SCALES[shape.radius] || RADIUS_SCALES.soft;
  group(
    `Tier 2 — radius scale: '${shape.radius}'. ` +
    "('sharp' → 0 / 2px, 'small' → 2px / 4px, 'soft' → 8px / 16px, 'round' → 16px / 28px.)",
  );
  push('--radius-base', radius.base);
  push('--radius-large', radius.large);

  group(
    "Tier 2 — texture treatment: 'paper' | 'flat'. " +
    'Components read this through the bg-paper utility layer in index.css.',
  );
  push('--texture', shape.texture);

  group(
    "Tier 2 — density: 'tight' | 'comfortable' | 'loose' (brief §4). The preset " +
    'states its own; a page may still set its own layout density in PR3.',
  );
  push('--density', shape.density);

  group('Tier 2 — motion (brief §2.2). Functional 120–200ms; one signature under 600ms.');
  for (const [step, value] of tokenEntries(tokens.semantic.motion)) push(`--motion-${step}`, value);

  group('Tier 2 — named weights, so a component never writes a raw number.');
  for (const [step, value] of tokenEntries(tokens.semantic.weight)) push(`--weight-${step}`, value);

  const activeSet = resolveMotifSet(theme);
  group(
    `Motif layer (brief §3.8) — the active set, '${activeSet}', as the ` +
    'attribute-free baseline. The [data-motif-set] blocks below carry every set.',
  );
  for (const [name, value] of motifSlotValues(tokens.motifs, activeSet)) push(name, value);

  for (const [component, contract] of tokenEntries(tokens.components)) {
    const nonColor = tokenEntries(contract).filter(([name]) => !name.endsWith('-rgb'));
    if (nonColor.length === 0) continue;
    group(`Tier 3 — ${component} contract (brief §3.1).`);
    for (const [name, value] of nonColor) push(name, value);
  }

  const presetTokens = resolvePresetTokens(theme);
  if (Object.keys(presetTokens).length > 0 || Object.keys(componentStacks).length > 0) {
    group(
      `Preset remaps — ${preset ? preset.id : 'none'} and its picked options. ` +
      'An option remaps existing tier 2 and tier 3 tokens and never adds a ' +
      'property name (brief §3.4), so every name here is declared above.',
    );
    for (const [name, value] of Object.entries(presetTokens)) push(name, value);
    for (const [name, value] of Object.entries(componentStacks)) push(name, value);
  }

  const adminFonts = resolveAdminFonts(tokens);
  group(
    'Admin identity — fixed type and shape (admin story part 6g). Never ' +
    'writable from config/theme: the pairing is the identity.',
  );
  for (const [name, value] of Object.entries(adminFonts.stacks)) push(name, value);
  for (const [name, value] of tokenEntries(tokens.admin.scalars)) push(name, value);

  return lines;
}

/**
 * A block's selector list.
 *
 * Every palette block matches TWO ways: on `:root`, which is what a whole
 * page renders from, and on any element carrying the same attributes, which
 * is what the admin's live-preview frame renders from (brief §5.2 — the
 * client's design is contained inside the frame, and the room around it
 * never adopts it). A scoped element's own declarations beat the values it
 * inherits from `:root`, so the frame gets the whole set — the tier-2
 * aliases and the tier-3 contracts included — with no second resolver and
 * no duplicated token list.
 *
 * The `admin-*` blocks deliberately do NOT get this treatment: the admin
 * never renders inside the frame, and keeping them root-only keeps "emitted
 * once per mode" exactly as narrow as it reads.
 *
 * @param {string} attributes e.g. "[data-mode='dark']"
 * @returns {string}
 */
function scopedSelector(attributes) {
  return `:root${attributes},\n${attributes}`;
}

/**
 * One block of custom properties.
 *
 * @param {string} selector
 * @param {string[]} names token order
 * @param {Record<string, string>} values
 * @param {string} comment
 * @returns {string[]} CSS lines
 */
function colorBlock(selector, names, values, comment) {
  const lines = [`/* ${comment} */`, `${selector} {`];
  for (const name of names) lines.push(`  ${name}: ${values[name]};`);
  lines.push('}');
  return lines;
}

/**
 * The first-paint dark block a non-light deployment needs, for one token set.
 *
 * The attribute-free baseline carries the LIGHT values, because that is what
 * a light deployment renders and what an unstyled page should fall back to.
 * On a dark or system deployment that baseline is wrong for the moment
 * between first paint and the runtime writing `data-mode`, and the reader
 * sees a flash of the other mode. So the dark values are repeated under
 * `:root:not([data-mode])`, which stops matching the instant the attribute
 * lands.
 *
 * Every token set that has a light baseline needs this — the palette and the
 * admin set alike. The admin ships on the same page as the public tokens and
 * paints the same first frame; leaving it out meant an admin on a dark
 * deployment flashed the light room before React mounted.
 *
 * @param {string} policy the mode policy (`light` | `dark` | `system`)
 * @param {string[]} names token order
 * @param {Record<string, string>} dark the dark values
 * @param {string} comment
 * @returns {string[]} CSS lines, empty under the `light` policy
 */
function firstPaintDarkBlock(policy, names, dark, comment) {
  if (policy === 'dark') {
    return ['', ...colorBlock(':root:not([data-mode])', names, dark, comment)];
  }
  if (policy === 'system') {
    return [
      '',
      `/* ${comment} */`,
      '@media (prefers-color-scheme: dark) {',
      ...colorBlock(':root:not([data-mode])', names, dark, 'Dark until data-mode lands.')
        .map((line) => `  ${line}`),
      '}',
    ];
  }
  return [];
}

/**
 * Every custom property `config/theme` resolves to, as CSS text.
 *
 * The color blocks follow brief §3.3 with one addition: an attribute-free
 * `:root` baseline carrying the light values. Without it a page would
 * paint unstyled until JavaScript wrote `data-mode`. The baseline is the
 * light palette; `:root[data-mode='light']` repeats it so the two blocks
 * stay symmetrical and the dark-mode completeness test (brief §8.2) can
 * compare them; `:root[data-mode='dark']` carries the dark palette.
 *
 * A deployment whose mode policy is not `light` also gets a first-paint
 * block scoped to `:root:not([data-mode])`, so the ground is right before
 * the runtime writes the attribute. Once the attribute lands the block
 * stops matching.
 *
 * On top of that, PR2 emits one block per (preset, mode) pair (brief §3.4),
 * one block per motif set (brief §3.8), and the `admin-*` set once per mode
 * — never once per (theme, mode) pair, which is the mechanical statement of
 * "the admin ignores data-theme" (brief §8.2).
 *
 * @param {object} theme config/theme
 * @param {{ tokensDir?: string }} [options]
 * @returns {string}
 */
function buildTokenCss(theme, { tokensDir } = {}) {
  const tokens = loadTokens(tokensDir);
  const { names, values } = resolveColorTokens(theme, tokens);
  const policy = modePolicy(theme);
  const activePreset = themePresetId(theme);

  const lines = [];
  lines.push(':root {');
  lines.push(...rootBlock(theme, tokens));
  lines.push('}');

  if (names.length > 0) {
    lines.push('');
    lines.push(
      ...colorBlock(
        ':root',
        names,
        values.light,
        'Light palette, attribute-free baseline — what first paint renders before ' +
        'the runtime writes data-mode.',
      ),
    );
    lines.push('');
    lines.push(
      ...colorBlock(
        scopedSelector("[data-mode='light']"),
        names,
        values.light,
        'Light palette (brief §3.3). Every color token is defined in both mode blocks.',
      ),
    );
    lines.push('');
    lines.push(
      ...colorBlock(
        scopedSelector("[data-mode='dark']"),
        names,
        values.dark,
        'Dark palette (brief §3.3). Its own palette, never light mode reversed.',
      ),
    );

    lines.push(
      ...firstPaintDarkBlock(
        policy,
        names,
        values.dark,
        policy === 'dark'
          ? "config/theme.mode is 'dark', so first paint is dark too."
          : "config/theme.mode is 'system': first paint follows the reader's setting.",
      ),
    );

    // One block per (preset, mode) pair (brief §3.4). The ACTIVE preset's
    // pair carries this deployment's resolved palette — its stored colors
    // and its per-mode overrides — because a [data-theme][data-mode] block
    // outranks the attribute-free baselines above and would otherwise undo
    // them. Every other preset carries its own designed palette.
    lines.push('');
    lines.push('/* Theme presets (brief §3.4, §4). A theme remaps the same custom');
    lines.push('   properties: no block below introduces a property name the blocks');
    lines.push('   above do not already carry. data-theme picks which one wins. */');
    for (const id of THEME_PRESET_IDS) {
      const preset = id === activePreset
        ? { names, values }
        : colorTokensFromPalettes(getPreset(id).palette, tokens);
      for (const mode of THEME_MODES) {
        lines.push('');
        lines.push(
          ...colorBlock(
            scopedSelector(`[data-theme='${id}'][data-mode='${mode}']`),
            preset.names,
            preset.values[mode],
            `${id} — ${mode}` +
            (id === activePreset ? ', the active preset, with this deployment\'s overrides.' : '.'),
          ),
        );
      }
    }
  }

  // The admin set, emitted ONCE PER MODE — plus the same first-paint block
  // the palette gets, because the admin renders on the same page and paints
  // the same first frame. It never appears inside a [data-theme] block, and
  // that is the testable form of "the admin ignores data-theme" (admin story
  // part 6, brief §8.2).
  const adminTokens = resolveAdminTokens(theme, tokens);
  if (adminTokens.names.length > 0) {
    lines.push('');
    lines.push(
      ...colorBlock(
        ":root,\n:root[data-mode='light']",
        adminTokens.names,
        adminTokens.values.light,
        'Admin identity — light (admin story part 6). Emitted once per mode, never ' +
        'once per theme: the admin obeys data-mode and ignores data-theme.',
      ),
    );
    lines.push('');
    lines.push(
      ...colorBlock(
        ":root[data-mode='dark']",
        adminTokens.names,
        adminTokens.values.dark,
        'Admin identity — dark, the night side. Authored value by value.',
      ),
    );
    lines.push(
      ...firstPaintDarkBlock(
        policy,
        adminTokens.names,
        adminTokens.values.dark,
        policy === 'dark'
          ? "Admin identity — first paint. config/theme.mode is 'dark', so the room " +
            'is dark before React writes data-mode.'
          : "Admin identity — first paint. config/theme.mode is 'system', so the room " +
            "follows the reader's setting until data-mode lands.",
      ),
    );
  }

  // One block per motif set (brief §3.8). A custom property cannot rewrite
  // the asset a second custom property points at, so the set switch is an
  // attribute, exactly like data-theme and data-mode.
  const setIds = Object.keys(tokens.motifs.sets || {});
  if (setIds.length > 0) {
    lines.push('');
    lines.push('/* Motif sets (brief §3.8). Each block resolves every slot token to that');
    lines.push('   set\'s asset. Render a slot as a mask-image painted with');
    lines.push('   background-color: rgb(var(--color-ink-motif-rgb)), or inline the SVG as a');
    lines.push('   symbol reading currentColor. Never an <img>, never a url() fill. */');
    for (const setId of setIds) {
      const slots = motifSlotValues(tokens.motifs, setId);
      lines.push('');
      lines.push(`${scopedSelector(`[data-motif-set='${setId}']`)} {`);
      for (const [name, value] of slots) lines.push(`  ${name}: ${value};`);
      lines.push('}');
    }
  }

  const adminFaces = resolveAdminFonts(tokens).faces;
  const seen = new Set();
  const declared = [];
  for (const face of [...resolveSelectableFaces(), ...adminFaces]) {
    if (seen.has(face.file)) continue;
    seen.add(face.file);
    declared.push(face);
  }
  if (declared.length > 0) {
    lines.push('');
    lines.push('/* Self-hosted font faces (spec §7.4): woff2 only, no font CDN at runtime.');
    lines.push('   Files live in apps/web/public/fonts/. Every bundled face is DECLARED,');
    lines.push('   because config/theme arrives live and buildRuntimeThemeCss can resolve');
    lines.push('   a role to any bundled set — a preset published from the admin, a picked');
    lines.push('   heading-face option, a role named outright, or the theme preview. A');
    lines.push('   family with no block here renders the fallback stack instead.');
    lines.push('');
    lines.push('   Declaring is not downloading: @font-face is lazy, so a browser fetches');
    lines.push('   a file only when a rendered element resolves to that family. A reader');
    lines.push('   still downloads only the faces this deployment actually paints with');
    lines.push('   (brief §4) — the cost of the rest is these CSS bytes, not bandwidth. */');
    for (const { family, file, weight } of declared) {
      lines.push('@font-face {');
      lines.push(`  font-family: '${family}';`);
      lines.push('  font-style: normal;');
      lines.push(`  font-weight: ${weight};`);
      lines.push('  font-display: swap;');
      lines.push(`  src: url('/fonts/${file}.woff2') format('woff2');`);
      lines.push('}');
    }
  }

  return lines.join('\n');
}

module.exports = {
  buildTokenCss,
  loadTokens,
  resolveColorTokens,
  resolveAdminTokens,
  resolveFonts,
  resolveSelectableFaces,
  resolveAdminFonts,
  modePolicy,
  TOKENS_DIR,
  TOKEN_FILES,
  internals: { tokenEntries, primitiveColor, colorTokensFromPalettes, motifSlotValues },
};
