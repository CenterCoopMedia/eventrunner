// The theme editor — the proof (design brief §5.2; admin story moment 2).
//
// A split view: the controls bench on one side, the client's REAL rendered
// page on the other, framed as a forme locked in a chase on the admin
// ground. The frame is the only place a client's design renders inside the
// admin, and the room around it never adopts it.
//
// TWO DEPTHS, in this order (brief §5.2):
//
//   1. The curated pickers. The preset, then its own option groups from the
//      preset catalog (heading face, nameplate treatment, component
//      variants), the motif set, the mode policy, and the one client-owned
//      colour in the admin identity. Most operators never leave this depth.
//   2. The advanced path, behind its own disclosure: raw per-mode token
//      overrides with a light tab and a dark tab. Raw token editing is never
//      the first thing an operator meets.
//
// CONTRAST. A failing pair is stated inline in the control that caused it,
// naming the pair, the mode, and the measured ratio, and the frame keeps
// rendering so the operator can see what they have done. A draft may hold a
// failing value; a published document may not — `updateTheme` rejects the
// write and states the same three facts (functions/src/admin/config.cjs).
//
// WHAT IS SAVED. config/theme is a WHOLE-DOC replace, so the payload always
// carries every field together: preset, optionPicks, tokens, motifSet,
// adminAccent, mode, fonts, texture, radius, logos, and colors. Dropping one
// on a save would silently delete it — which is exactly what would happen to
// `preset` if this form still sent the pre-preset shape.
//
// Logo/asset slots are unchanged: config/theme.logos holds PATHS into the
// Storage bucket, and each slot is an ImagePicker over the `branding/`
// namespace. Whatever is in `logos` is carried through every save verbatim.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getPreset, findThemeContrastFailures, resolveOptionPicks } from 'shared/theme';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import {
  DEFAULT_MODE_POLICY,
  FONT_SET_IDS,
  MODE_POLICY_IDS,
  MOTIF_SET_IDS,
  PRESET_IDS,
  RADIUS_IDS,
  THEME_COLOR_KEYS,
  THEME_COLOR_PROPERTIES,
  THEME_FONT_ROLES,
  TEXTURE_IDS,
  adminAccentVerdict,
  rgbTripleToHex,
} from '../../lib/themeRuntime.js';
import { clearThemePreview } from '../themePreview.js';
import {
  DestructiveConfirm,
  Notice,
  Panel,
  SaveStatus,
  SelectField,
  ServerErrorSummary,
  TextField,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, { RecordState } from '../components/adminChrome.jsx';
import { state } from '../recordState.js';
import ThemeProof, { PROOF_PAGES } from '../components/ThemeProof.jsx';
import ImagePicker from '../components/media/ImagePicker.jsx';

const LOGO_SLOTS = ['primary', 'mark', 'footer', 'ogDefault', 'favicon'];

/** What each slot is FOR — a path field alone never says (spec §7.2). */
const LOGO_SLOT_LABELS = {
  primary: 'Primary logo',
  mark: 'Mark (square icon)',
  footer: 'Footer logo',
  ogDefault: 'Social sharing image',
  favicon: 'Favicon',
};

const LOGO_SLOT_HINTS = {
  primary: 'The header logo, shown at the top of every page.',
  mark: 'A square version for tight spaces.',
  footer: 'Used in the site footer; falls back to the primary logo.',
  ogDefault: 'The image link previews use when a page has none of its own.',
  favicon: 'The browser tab icon.',
};

/** A hex value the schema accepts: #RGB or #RRGGBB. */
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * The value to hand a native color picker. `<input type="color">` only
 * understands the six-digit form: given #fff it sanitizes the value to black
 * and would then write that black back over a perfectly valid stored color on
 * the next interaction. Expanding the shorthand keeps the picker showing the
 * real color, while the text field beside it still holds what the operator
 * actually typed.
 */
export function toPickerHex(value) {
  if (typeof value !== 'string' || !HEX_COLOR_RE.test(value.trim())) return null;
  const digits = value.trim().slice(1);
  return digits.length === 3
    ? `#${digits.split('').map((ch) => ch + ch).join('')}`
    : `#${digits}`;
}

/**
 * Seed one legacy color input. config/theme.colors wins; otherwise the value
 * currently resolved on :root (the build-time palette from generated
 * theme.css) is read back and converted to hex, so the editor starts from
 * what the site actually looks like rather than from blanks.
 */
function seedColor(colors, key) {
  const configured = colors?.[key];
  if (typeof configured === 'string' && configured) return configured;
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return '';
  const resolved = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(THEME_COLOR_PROPERTIES[key]);
  return rgbTripleToHex(resolved) ?? '';
}

/** The editable form for a stored config/theme document. */
function toForm(theme) {
  const colors = {};
  for (const key of THEME_COLOR_KEYS) colors[key] = seedColor(theme?.colors, key);
  // A role left blank is the preset's to decide. Naming one outright is the
  // advanced path, and it is what a pre-preset deployment already stores.
  const fonts = {};
  for (const role of THEME_FONT_ROLES) {
    fonts[role] = FONT_SET_IDS.includes(theme?.fonts?.[role]) ? theme.fonts[role] : '';
  }
  const logos = {};
  for (const slot of LOGO_SLOTS) {
    logos[slot] = typeof theme?.logos?.[slot] === 'string' ? theme.logos[slot] : '';
  }
  const tokens = { light: {}, dark: {} };
  for (const mode of ['light', 'dark']) {
    for (const key of THEME_COLOR_KEYS) {
      const stored = theme?.tokens?.[mode]?.[key];
      tokens[mode][key] = typeof stored === 'string' ? stored : '';
    }
  }
  const preset = PRESET_IDS.includes(theme?.preset) ? theme.preset : '';
  return {
    preset,
    optionPicks: preset ? resolveOptionPicks(theme) : {},
    tokens,
    colors,
    fonts,
    logos,
    motifSet: MOTIF_SET_IDS.includes(theme?.motifSet) ? theme.motifSet : '',
    adminAccent: typeof theme?.adminAccent === 'string' ? theme.adminAccent : '',
    texture: TEXTURE_IDS.includes(theme?.texture) ? theme.texture : TEXTURE_IDS[0],
    radius: RADIUS_IDS.includes(theme?.radius) ? theme.radius : RADIUS_IDS[1] ?? RADIUS_IDS[0],
    // A stored document that predates the mode policy has no `mode`, and
    // light is what it renders, so light is what the form starts on.
    mode: MODE_POLICY_IDS.includes(theme?.mode) ? theme.mode : DEFAULT_MODE_POLICY,
  };
}

/** Drop the blank entries: an empty field means "not set", never "". */
function filled(map) {
  const out = {};
  for (const [key, value] of Object.entries(map)) {
    if (typeof value === 'string' && value.trim()) out[key] = value.trim();
  }
  return out;
}

/**
 * The candidate config/theme document — the WHOLE document, every time.
 * `colors` rides along as stored: for a preset document it is an output the
 * publish path materializes from the resolved palette, and for a pre-preset
 * document it is still the palette.
 */
export function toThemeDoc(form) {
  const doc = {
    colors: filled(form.colors),
    fonts: filled(form.fonts),
    logos: filled(form.logos),
    texture: form.texture,
    radius: form.radius,
    mode: form.mode,
  };
  if (form.preset) {
    doc.preset = form.preset;
    doc.optionPicks = { ...form.optionPicks };
  }
  const tokens = {};
  for (const mode of ['light', 'dark']) {
    const overrides = filled(form.tokens[mode]);
    if (Object.keys(overrides).length > 0) tokens[mode] = overrides;
  }
  if (Object.keys(tokens).length > 0) doc.tokens = tokens;
  if (form.motifSet) doc.motifSet = form.motifSet;
  if (form.adminAccent.trim()) doc.adminAccent = form.adminAccent.trim();
  return doc;
}

const COLOR_LABELS = {
  primary: 'Primary',
  primaryDark: 'Primary (dark)',
  primaryLight: 'Primary (light)',
  accent: 'Accent',
  surface: 'Surface',
  surfaceAlt: 'Surface (alt)',
  ink: 'Ink',
  inkMuted: 'Ink (muted)',
  success: 'Success',
  warning: 'Warning',
  danger: 'Danger',
  highlight: 'Highlight',
  keynote: 'Keynote',
};

const FONT_SET_LABELS = {
  'serif-editorial': 'Serif editorial',
  'sans-humanist': 'Sans humanist',
  'script-casual': 'Script casual',
};

const RADIUS_LABELS = { sharp: 'Sharp', small: 'Small', soft: 'Soft', round: 'Round' };
const TEXTURE_LABELS = { paper: 'Paper', flat: 'Flat' };

/** config/theme.mode, in words an operator can act on (design brief §3.3). */
const MODE_LABELS = {
  light: 'Always light',
  dark: 'Always dark',
  system: 'Follow the reader’s setting',
};

/** What each font role is FOR — the role name alone does not say. */
const FONT_ROLE_LABELS = {
  heading: 'Heading font',
  body: 'Body font',
  data: 'Data font',
  mono: 'Figures and code font',
};

const MOTIF_SET_LABELS = {
  none: 'No motifs',
  botanical: 'Botanical plates',
  fauna: 'Fauna engravings',
  cartographic: 'Survey linework',
};

export default function AdminBranding() {
  const { theme, sources } = useEventConfig();
  const call = useAdminApi();
  const { showToast } = useToast();

  const [form, setForm] = useState(() => toForm(theme));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [proofPath, setProofPath] = useState(PROOF_PAGES[0].path);
  const [proofMode, setProofMode] = useState('light');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [overrideMode, setOverrideMode] = useState('light');
  const errorRef = useRef(null);
  const adoptedRef = useRef(sources.theme === 'live');

  // Seeding reads unset colors back from the resolved custom properties, so
  // the preview overlay must be gone first — otherwise a color the saved
  // theme does not set would "revert" to the unsaved candidate. The preview
  // effect in ThemeProof re-applies from the fresh form on the next render.
  const reseedFromTheme = useCallback((themeDoc) => {
    clearThemePreview();
    setForm(toForm(themeDoc));
  }, []);

  // Adopt the runtime doc once CONFIG/THEME itself arrives, then leave the
  // form alone so a listener echo never overwrites in-progress edits.
  useEffect(() => {
    if (adoptedRef.current || sources.theme !== 'live') return;
    adoptedRef.current = true;
    reseedFromTheme(theme);
  }, [sources.theme, theme, reseedFromTheme]);

  const candidate = useMemo(() => toThemeDoc(form), [form]);
  const saved = useMemo(() => JSON.stringify(toThemeDoc(toForm(theme))), [theme]);
  const isDirty = JSON.stringify(candidate) !== saved;

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const fieldErrors = useMemo(() => {
    const map = new Map();
    for (const segment of error?.fieldErrors ?? []) {
      if (segment.field && !map.has(segment.field)) map.set(segment.field, segment.message);
    }
    return map;
  }, [error]);

  // The same three facts the publish path states, shown here first: the
  // pair, the mode, and the measured ratio. Keyed by the foreground role in
  // that mode, which is the control an operator would go and change.
  const contrastFailures = useMemo(() => findThemeContrastFailures(candidate), [candidate]);
  const failureFor = (mode, key) =>
    contrastFailures.find((failure) => failure.mode === mode && failure.foreground === key);

  const preset = getPreset(form.preset);
  const accent = adminAccentVerdict(candidate, proofMode);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setStatus('');
    try {
      await call('updateTheme', { theme: candidate });
      setStatus('Published. The public site restyles live — no deploy needed.');
      showToast('Theme published.');
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  function revert() {
    reseedFromTheme(theme);
    setStatus('Reverted to the saved theme.');
  }

  const proofPageLabel =
    PROOF_PAGES.find((page) => page.path === proofPath)?.label ?? proofPath;

  return (
    <form className="flex flex-col gap-md" onSubmit={submit}>
      <AdminPageHeader
        title="Branding"
        state={<RecordState state={isDirty ? state('dirty') : state('live')} />}
        identifiers="config/theme"
        description="Pick the preset, then its curated options. The frame beside the bench renders the client's real pages with the draft applied; nothing reaches the public site until you publish."
        actions={
          <>
            <button type="submit" className={primaryButtonClass} disabled={saving}>
              {saving ? 'Publishing…' : 'Publish the theme'}
            </button>
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={revert}
              disabled={saving}
            >
              Revert to the saved theme
            </button>
          </>
        }
      />

      <ServerErrorSummary error={error} errorRef={errorRef} title="The server rejected this theme" />
      {status ? <SaveStatus message={status} /> : null}
      {contrastFailures.length > 0 ? (
        <Notice
          tone="caution"
          message={`This draft holds ${contrastFailures.length} contrast ${
            contrastFailures.length === 1 ? 'failure' : 'failures'
          }. A draft may hold one; publishing rejects it. ${contrastFailures
            .map((failure) => failure.message.replace('theme contrast: ', ''))
            .join('; ')}.`}
        />
      ) : null}

      <div className="grid gap-md xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        {/* ------------------------------------------- the controls bench */}
        <div className="flex min-w-0 flex-col gap-md">
          <Panel
            title="Preset"
            description="The base look: two authored palettes, a type map, a shape, and a motif default. Picking a preset replaces every value you have not overridden yourself. Your own per-mode overrides and any font role you name below stay as they are."
          >
            <div className="flex flex-col gap-sm">
              <SelectField
                label="Preset"
                value={form.preset}
                options={[
                  { value: '', label: 'None — this deployment’s stored palette' },
                  ...PRESET_IDS.map((id) => ({ value: id, label: getPreset(id).label })),
                ]}
                onChange={(value) =>
                  setForm((c) => ({
                    ...c,
                    preset: value,
                    // A pick from another preset's groups means nothing here,
                    // and the server rejects it by name.
                    optionPicks: value ? resolveOptionPicks({ preset: value }) : {},
                  }))
                }
                error={fieldErrors.get('theme.preset')}
              />
              {preset ? (
                <p className="max-w-[65ch] text-caption text-admin-ink-secondary">
                  {preset.summary}
                </p>
              ) : null}
            </div>
          </Panel>

          {preset ? (
            <Panel
              title="Options"
              description={`The curated choices ${preset.label} offers. Each one remaps tokens the preset already declares — it never invents a value.`}
            >
              <div className="flex flex-col gap-sm">
                {Object.entries(preset.options ?? {}).map(([group, spec]) => {
                  const picked = (spec.choices ?? []).find(
                    (choice) => choice.id === form.optionPicks[group],
                  );
                  return (
                    <SelectField
                      key={group}
                      label={spec.label}
                      hint={picked?.why ?? spec.prompt}
                      value={form.optionPicks[group] ?? spec.default}
                      options={(spec.choices ?? []).map((choice) => ({
                        value: choice.id,
                        label: choice.label,
                      }))}
                      onChange={(value) =>
                        setForm((c) => ({
                          ...c,
                          optionPicks: { ...c.optionPicks, [group]: value },
                        }))
                      }
                      error={fieldErrors.get(`theme.optionPicks.${group}`)}
                    />
                  );
                })}
              </div>
            </Panel>
          ) : null}

          <Panel title="Motifs, mode, and the admin mark">
            <div className="flex flex-col gap-sm">
              <SelectField
                label="Motif set"
                value={form.motifSet}
                options={[
                  {
                    value: '',
                    label: preset
                      ? `The preset’s own set (${MOTIF_SET_LABELS[preset.motifSet] ?? preset.motifSet})`
                      : 'No motifs',
                  },
                  ...MOTIF_SET_IDS.map((id) => ({ value: id, label: MOTIF_SET_LABELS[id] ?? id })),
                ]}
                onChange={(value) => setForm((c) => ({ ...c, motifSet: value }))}
                hint="Small drawings that carry a preset's vocabulary. They inherit theme ink and never carry their own colour."
                error={fieldErrors.get('theme.motifSet')}
              />
              <SelectField
                label="Light or dark"
                value={form.mode}
                options={MODE_POLICY_IDS.map((id) => ({ value: id, label: MODE_LABELS[id] ?? id }))}
                onChange={(value) => setForm((c) => ({ ...c, mode: value }))}
                hint="Every theme defines both. Follow the reader lets each visitor’s own setting decide."
                error={fieldErrors.get('theme.mode')}
              />
              <TextField
                label="Admin marker colour"
                value={form.adminAccent}
                onChange={(value) => setForm((c) => ({ ...c, adminAccent: value }))}
                hint="A hex colour. The admin uses it in exactly two places: the marker beside the section you are in, and the mark on the page-header rule. Leave it blank for the admin's own ink."
                error={fieldErrors.get('theme.adminAccent')}
              />
              {/* The legibility floor, stated plainly. The value is never
                  clamped: the admin says what it fell back to instead. */}
              {accent.fellBack ? (
                <Notice
                  tone="caution"
                  message={`That colour reads at ${accent.ratio.toFixed(2)}:1 against the ${proofMode} admin ground, below the ${accent.floor}:1 floor a position marker needs. The admin marker falls back to its own ink. Your value is stored exactly as you typed it.`}
                />
              ) : null}
            </div>
          </Panel>

          <Panel
            title="Logos and assets"
            description="Each slot points at a file in the media library. Choose an existing file or upload a new one."
          >
            <div className="grid gap-md sm:grid-cols-2">
              {LOGO_SLOTS.map((slot) => (
                <ImagePicker
                  key={slot}
                  folder="branding"
                  label={LOGO_SLOT_LABELS[slot] ?? slot}
                  hint={LOGO_SLOT_HINTS[slot]}
                  value={form.logos[slot]}
                  onChange={(value) =>
                    setForm((c) => ({ ...c, logos: { ...c.logos, [slot]: value } }))
                  }
                  error={fieldErrors.get(`theme.logos.${slot}`)}
                />
              ))}
            </div>
          </Panel>

          {/* ------------------------------------------- the second depth */}
          <Panel title="Advanced">
            <button
              type="button"
              className={secondaryButtonClass}
              aria-expanded={advancedOpen}
              aria-controls="admin-theme-advanced"
              onClick={() => setAdvancedOpen((open) => !open)}
            >
              {advancedOpen ? 'Hide the raw tokens' : 'Edit the raw tokens'}
            </button>
            <div id="admin-theme-advanced" hidden={!advancedOpen} className="mt-sm">
              <p className="mb-sm max-w-[65ch] text-caption text-admin-ink-secondary">
                Per-mode colour overrides. A value here wins over the preset in
                that mode only; a blank field keeps the preset’s own value. A
                pair that fails contrast is named under the field, and
                publishing a failing pair is refused.
              </p>

              <div
                role="group"
                aria-label="Override mode"
                className="flex items-center gap-xs border-admin-rule-hairline border-b-admin-hairline pb-2xs"
              >
                {['light', 'dark'].map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={overrideMode === mode}
                    className={
                      overrideMode === mode
                        ? `${primaryButtonClass}`
                        : `${secondaryButtonClass}`
                    }
                    onClick={() => setOverrideMode(mode)}
                  >
                    {mode === 'light' ? 'Light mode' : 'Dark mode'}
                  </button>
                ))}
              </div>

              <div className="mt-sm grid gap-sm sm:grid-cols-2">
                {THEME_COLOR_KEYS.map((key) => {
                  const failure = failureFor(overrideMode, key);
                  return (
                    <TextField
                      key={`${overrideMode}-${key}`}
                      label={`${COLOR_LABELS[key] ?? key} — ${overrideMode}`}
                      value={form.tokens[overrideMode][key]}
                      onChange={(value) =>
                        setForm((c) => ({
                          ...c,
                          tokens: {
                            ...c.tokens,
                            [overrideMode]: { ...c.tokens[overrideMode], [key]: value },
                          },
                        }))
                      }
                      hint={
                        failure
                          ? `${failure.foreground} on ${failure.background} in ${failure.mode} mode is ${failure.ratio.toFixed(2)}:1, below the ${failure.min}:1 bar.`
                          : undefined
                      }
                      error={fieldErrors.get(`theme.tokens.${overrideMode}.${key}`)}
                    />
                  );
                })}
              </div>

              <div className="mt-sm">
                <DestructiveConfirm
                  trigger="Clear the overrides for this mode"
                  title={`Clear the ${overrideMode} overrides`}
                  confirmLabel="Clear these overrides"
                  consequence={`Every ${overrideMode}-mode colour you have set by hand goes, and that mode falls back to the preset's own palette.`}
                  permanence="The draft keeps everything else. Reverting to the saved theme brings them back until you publish."
                  onConfirm={() =>
                    setForm((c) => ({
                      ...c,
                      tokens: {
                        ...c.tokens,
                        [overrideMode]: Object.fromEntries(
                          THEME_COLOR_KEYS.map((key) => [key, '']),
                        ),
                      },
                    }))
                  }
                />
              </div>

              <div className="mt-md grid gap-sm sm:grid-cols-2">
                {THEME_FONT_ROLES.map((role) => (
                  <SelectField
                    key={role}
                    label={FONT_ROLE_LABELS[role] ?? `${role} font`}
                    value={form.fonts[role]}
                    options={[
                      { value: '', label: 'The preset’s own face' },
                      ...FONT_SET_IDS.map((id) => ({
                        value: id,
                        label: FONT_SET_LABELS[id] ?? id,
                      })),
                    ]}
                    onChange={(value) =>
                      setForm((c) => ({ ...c, fonts: { ...c.fonts, [role]: value } }))
                    }
                    error={fieldErrors.get(`theme.fonts.${role}`)}
                  />
                ))}
                <SelectField
                  label="Texture"
                  value={form.texture}
                  options={TEXTURE_IDS.map((id) => ({ value: id, label: TEXTURE_LABELS[id] ?? id }))}
                  onChange={(value) => setForm((c) => ({ ...c, texture: value }))}
                  hint="Paper paints a subtle dot pattern behind the page; flat removes it."
                />
                <SelectField
                  label="Corner radius"
                  value={form.radius}
                  options={RADIUS_IDS.map((id) => ({ value: id, label: RADIUS_LABELS[id] ?? id }))}
                  onChange={(value) => setForm((c) => ({ ...c, radius: value }))}
                />
              </div>

              {form.preset ? null : (
                // A deployment made before presets existed keeps its stored
                // palette, and this is the control that edits it.
                <div className="mt-md grid gap-sm sm:grid-cols-2">
                  {THEME_COLOR_KEYS.map((key) => (
                    <div key={key} className="flex items-end gap-sm">
                      {toPickerHex(form.colors[key]) ? (
                        <input
                          type="color"
                          aria-label={`${COLOR_LABELS[key] ?? key} color picker`}
                          value={toPickerHex(form.colors[key])}
                          onChange={(event) =>
                            setForm((c) => ({
                              ...c,
                              colors: { ...c.colors, [key]: event.target.value },
                            }))
                          }
                          className="admin-target h-9 w-12 rounded-admin border-admin-hairline border-admin-rule-strong bg-admin-ground-input p-3xs"
                        />
                      ) : null}
                      <div className="flex-1">
                        <TextField
                          label={COLOR_LABELS[key] ?? key}
                          value={form.colors[key]}
                          onChange={(value) =>
                            setForm((c) => ({ ...c, colors: { ...c.colors, [key]: value } }))
                          }
                          error={fieldErrors.get(`theme.colors.${key}`)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Panel>
        </div>

        {/* -------------------------------------------------- the proof */}
        <div className="flex min-w-0 flex-col gap-xs">
          <div className="flex flex-wrap items-center gap-xs">
            <div
              role="group"
              aria-label="Page to preview"
              className="flex flex-wrap items-center gap-2xs"
            >
              {PROOF_PAGES.map((page) => (
                <button
                  key={page.path}
                  type="button"
                  aria-pressed={proofPath === page.path}
                  className={proofPath === page.path ? primaryButtonClass : secondaryButtonClass}
                  onClick={() => setProofPath(page.path)}
                >
                  {page.label}
                </button>
              ))}
            </div>
            {/* Two proofs of the same forme. Switching re-renders instantly,
                with no animation, because wayfinding is instant (§2.2). */}
            <div
              role="group"
              aria-label="Mode to preview"
              className="flex flex-wrap items-center gap-2xs"
            >
              {['light', 'dark'].map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={proofMode === mode}
                  className={proofMode === mode ? primaryButtonClass : secondaryButtonClass}
                  onClick={() => setProofMode(mode)}
                >
                  {mode === 'light' ? 'Light' : 'Dark'}
                </button>
              ))}
            </div>
          </div>

          <ThemeProof
            themeDoc={candidate}
            path={proofPath}
            mode={proofMode}
            identification={`${proofPageLabel} · ${proofMode} · ${
              isDirty ? 'unpublished draft' : 'published theme'
            }`}
          />
        </div>
      </div>
    </form>
  );
}
