// The theme editor — the staff workflow and the page preview (design brief
// §5.2; admin story moment 2; owner review and calibration, 2026-08-27).
//
// A split view: the decisions on one side, the client's REAL rendered page on
// the other, framed as a forme locked in a chase on the admin ground. The
// frame is the only place a client's design renders inside the admin, and the
// room around it never adopts it.
//
// BROAD UNDERNEATH, SIMPLE AT FIRST CONTACT. Every one of the six styles is
// complete and offered without a warning label, and every control the system
// has is still here. What changed is the ORDER a staff member meets them in.
//
// THE WORKFLOW — six decisions, then look, then publish:
//
//   1. Site style          which of the six, each with one recommended
//                          configuration that works the moment it is picked.
//   2. Logo and icon       the two slots every site needs; the other three
//                          sit behind "More image slots".
//   3. Main brand colour   ONE colour. The supporting shades are derived
//                          from it for both modes, contrast-safe by
//                          construction (shared/theme deriveBrandSteps).
//   4. Header style        the style's own header treatments.
//   5. Schedule style      how the programme is set.
//   6. Light or dark       the mode policy.
//
// Then the page preview, then Publish. That is the whole normal job.
//
// ADVANCED holds everything else, behind one disclosure: typography (the
// heading face and the four font roles), Illustrations, surface and shape,
// any style-specific extras, and the per-token colour overrides. Nothing was
// removed to get here — an operator who wants a token still edits a token.
//
// CONTRAST. A failing pair is stated inline in the control that caused it,
// naming the pair, the mode, and the measured ratio, and the frame keeps
// rendering so the operator can see what they have done. A draft may hold a
// failing value; a published document may not — `updateTheme` rejects the
// write and states the same three facts (functions/src/admin/config.cjs).
//
// WHAT IS SAVED. config/theme is a WHOLE-DOC replace, so the payload always
// carries every field together: preset, optionPicks, brandColor, tokens,
// motifSet, mode, fonts, texture, radius, density, logos, and colors.
// Dropping one on a save would silently delete it — which is exactly what
// would happen to `preset` if this form still sent the pre-preset shape.
//
// A BLANK SHAPE FIELD MEANS "THE STYLE DECIDES". Texture, corners, and
// density are seeded blank when the stored document names none, so opening
// the editor and pressing Publish cannot pin a style to a shape it never
// asked for. That is why Zine keeps its copier grain through a save.
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
  DENSITY_IDS,
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
import { choiceCopy, presetCopy } from '../presetCopy.js';
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
import ThemeProof from '../components/ThemeProof.jsx';
import ImagePicker from '../components/media/ImagePicker.jsx';

const LOGO_SLOTS = ['primary', 'mark', 'footer', 'ogDefault', 'favicon'];

/** The two slots the normal workflow asks for, in the order it asks. */
const WORKFLOW_LOGO_SLOTS = ['primary', 'mark'];

/** The rest, behind "More image slots". */
const EXTRA_LOGO_SLOTS = LOGO_SLOTS.filter((slot) => !WORKFLOW_LOGO_SLOTS.includes(slot));

/** What each slot is FOR — a path field alone never says (spec §7.2). */
const LOGO_SLOT_LABELS = {
  primary: 'Primary logo',
  mark: 'Square icon',
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

/**
 * The option groups the normal workflow asks about, in the order it asks.
 *
 * Every other group a style declares — the heading face, a style's pen marks
 * — is a typography or an ornament decision, and those live under Advanced.
 * A group this list does not name goes there automatically, so a style that
 * adds one lands in the right place without a code change here.
 */
const WORKFLOW_OPTION_GROUPS = ['nameplate', 'component'];

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
  // A role left blank is the style's to decide. Naming one outright is the
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
  const pick = (value, allowed) => (allowed.includes(value) ? value : '');
  return {
    preset,
    optionPicks: preset ? resolveOptionPicks(theme) : {},
    tokens,
    colors,
    fonts,
    logos,
    motifSet: pick(theme?.motifSet, MOTIF_SET_IDS),
    brandColor: typeof theme?.brandColor === 'string' ? theme.brandColor : '',
    // Blank means "the style decides". Seeding these to a concrete value
    // would let a save pin a style to a shape nobody chose.
    texture: pick(theme?.texture, TEXTURE_IDS),
    radius: pick(theme?.radius, RADIUS_IDS),
    density: pick(theme?.density, DENSITY_IDS),
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
  for (const field of ['texture', 'radius', 'density', 'motifSet']) {
    if (form[field]) doc[field] = form[field];
  }
  if (form.brandColor.trim()) doc.brandColor = form.brandColor.trim();
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

/** The three roles the brand colour derives. Everything else is the style's. */
const DERIVED_COLOR_KEYS = ['primary', 'primaryDark', 'primaryLight'];

const FONT_SET_LABELS = {
  'serif-editorial': 'Serif editorial',
  'sans-humanist': 'Sans humanist',
  'script-casual': 'Script casual',
};

const RADIUS_LABELS = { sharp: 'Sharp', small: 'Small', soft: 'Soft', round: 'Round' };
const TEXTURE_LABELS = { paper: 'Paper grain', flat: 'Flat' };
const DENSITY_LABELS = { tight: 'Tight', comfortable: 'Comfortable', loose: 'Loose' };

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

/**
 * The illustration sets. "Motif" is a design word; the control says what a
 * staff member would call the thing (owner review, 2026-08-27).
 */
const MOTIF_SET_LABELS = {
  none: 'No illustrations',
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [moreLogosOpen, setMoreLogosOpen] = useState(false);
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
  // The words for the picked style. The rendering values and the copy are
  // two generated outputs of one source, so a style always has both.
  const copy = presetCopy(form.preset);
  // The mode the admin marker's legibility is judged in: whichever mode the
  // preview is showing, so the warning and the picture agree.
  const [previewMode, setPreviewMode] = useState('light');
  const accent = adminAccentVerdict(candidate, previewMode);

  /** One option group, rendered as a picker with the reason for the pick. */
  const optionField = (group, spec) => {
    const groupCopy = copy.options[group];
    const picked = choiceCopy(form.preset, group, form.optionPicks[group]);
    return (
      <SelectField
        key={group}
        label={groupCopy.label}
        hint={picked?.why ?? groupCopy.prompt}
        value={form.optionPicks[group] ?? spec.default}
        options={(spec.choices ?? []).map((choice) => ({
          value: choice.id,
          label: groupCopy.choices[choice.id].label,
        }))}
        onChange={(value) =>
          setForm((c) => ({ ...c, optionPicks: { ...c.optionPicks, [group]: value } }))
        }
        error={fieldErrors.get(`theme.optionPicks.${group}`)}
      />
    );
  };

  const groupIds = Object.keys(preset?.options ?? {});
  const workflowGroups = WORKFLOW_OPTION_GROUPS.filter((group) => groupIds.includes(group));
  const advancedGroups = groupIds.filter(
    (group) => group !== 'headingFace' && !WORKFLOW_OPTION_GROUPS.includes(group),
  );

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

  return (
    <form className="flex flex-col gap-md" onSubmit={submit}>
      <AdminPageHeader
        title="Branding"
        state={<RecordState state={isDirty ? state('dirty') : state('live')} />}
        identifiers="config/theme"
        description="Six decisions make a finished site: the style, the logo, the brand colour, the header, the schedule, and light or dark. The page preview beside them renders the client's real pages with the draft applied; nothing reaches the public site until you publish."
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
        {/* ------------------------------------------- the staff decisions */}
        <div className="flex min-w-0 flex-col gap-md">
          {/* 1 ------------------------------------------------ site style */}
          <Panel
            title="Site style"
            description="Six complete styles. Each one arrives set up and ready — you can publish it as it stands. Picking a style replaces every value you have not set yourself."
          >
            <div className="flex flex-col gap-sm">
              <SelectField
                label="Site style"
                value={form.preset}
                options={[
                  { value: '', label: 'None — this deployment’s stored palette' },
                  ...PRESET_IDS.map((id) => ({ value: id, label: presetCopy(id).label })),
                ]}
                onChange={(value) =>
                  setForm((c) => ({
                    ...c,
                    preset: value,
                    // A pick from another style's groups means nothing here,
                    // and the server rejects it by name.
                    optionPicks: value ? resolveOptionPicks({ preset: value }) : {},
                  }))
                }
                error={fieldErrors.get('theme.preset')}
              />
              {copy ? (
                <p className="max-w-[65ch] text-caption text-admin-ink-secondary">
                  {copy.summary}
                  <span className="mt-3xs block text-admin-ink-data">
                    Best for: {copy.bestFor}
                  </span>
                </p>
              ) : null}
            </div>
          </Panel>

          {/* 2 --------------------------------------------- logo and icon */}
          <Panel
            title="Logo and icon"
            description="Each slot points at a file in the media library. Choose an existing file or upload a new one."
          >
            <div className="grid gap-md sm:grid-cols-2">
              {WORKFLOW_LOGO_SLOTS.map((slot) => (
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
            <div className="mt-sm">
              <button
                type="button"
                className={secondaryButtonClass}
                aria-expanded={moreLogosOpen}
                aria-controls="admin-theme-more-logos"
                onClick={() => setMoreLogosOpen((open) => !open)}
              >
                {moreLogosOpen ? 'Hide the other image slots' : 'More image slots'}
              </button>
              <div
                id="admin-theme-more-logos"
                hidden={!moreLogosOpen}
                className="mt-sm grid gap-md sm:grid-cols-2"
              >
                {EXTRA_LOGO_SLOTS.map((slot) => (
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
            </div>
          </Panel>

          {/* 3 ----------------------------------------- main brand colour */}
          <Panel
            title="Main brand colour"
            description="One colour. The darker and lighter shades that go with it are worked out for light mode and dark mode, and they are always readable on the page they land on."
          >
            <div className="flex flex-col gap-sm">
              <div className="flex items-end gap-sm">
                {toPickerHex(form.brandColor) ? (
                  <input
                    type="color"
                    aria-label="Main brand colour picker"
                    value={toPickerHex(form.brandColor)}
                    onChange={(event) =>
                      setForm((c) => ({ ...c, brandColor: event.target.value }))
                    }
                    className="admin-target h-9 w-12 rounded-admin border-admin-hairline border-admin-rule-strong bg-admin-ground-input p-3xs"
                  />
                ) : null}
                <div className="flex-1">
                  <TextField
                    label="Main brand colour"
                    value={form.brandColor}
                    onChange={(value) => setForm((c) => ({ ...c, brandColor: value }))}
                    hint="A hex colour, like the one in the client's brand guide. Leave it blank to keep the style's own colour."
                    error={fieldErrors.get('theme.brandColor')}
                  />
                </div>
              </div>
              {/* The admin marker's legibility floor, stated plainly. The
                  site keeps painting the client's colour; only the admin
                  marker steps aside, and it says so. */}
              {accent.fellBack ? (
                <Notice
                  tone="caution"
                  message={`This colour reads at ${accent.ratio.toFixed(2)}:1 against the ${previewMode} admin ground, below the ${accent.floor}:1 floor a position marker needs. The marker beside the section you are in falls back to the admin's own ink. The site itself is unaffected.`}
                />
              ) : null}
            </div>
          </Panel>

          {/* 4 and 5 --------------------- header style and schedule style */}
          {preset && workflowGroups.length > 0 ? (
            <Panel
              title="Header and schedule"
              description={`How ${copy.label} sets the top of a page and the programme. Each choice belongs to this style — it remaps values the style already declares and never invents one.`}
            >
              <div className="flex flex-col gap-sm">
                {workflowGroups.map((group) => optionField(group, preset.options[group]))}
              </div>
            </Panel>
          ) : null}

          {/* 6 -------------------------------------------- light or dark */}
          <Panel title="Light or dark">
            <SelectField
              label="Light or dark"
              value={form.mode}
              options={MODE_POLICY_IDS.map((id) => ({ value: id, label: MODE_LABELS[id] ?? id }))}
              onChange={(value) => setForm((c) => ({ ...c, mode: value }))}
              hint="Every style defines both. Follow the reader lets each visitor’s own setting decide."
              error={fieldErrors.get('theme.mode')}
            />
          </Panel>

          {/* ----------------------------------------------- the Advanced */}
          <Panel
            title="Advanced"
            description="Everything else the system can do. Nothing here is needed for a finished site."
          >
            <button
              type="button"
              className={secondaryButtonClass}
              aria-expanded={advancedOpen}
              aria-controls="admin-theme-advanced"
              onClick={() => setAdvancedOpen((open) => !open)}
            >
              {advancedOpen ? 'Hide the advanced settings' : 'Show the advanced settings'}
            </button>
            <div id="admin-theme-advanced" hidden={!advancedOpen} className="mt-sm flex flex-col gap-md">
              {/* ------------------------------------------- typography */}
              <section aria-labelledby="admin-theme-typography">
                <h3
                  id="admin-theme-typography"
                  className="font-admin-ui text-body font-semibold text-admin-ink"
                >
                  Typography
                </h3>
                <p className="mb-sm mt-3xs max-w-[65ch] text-caption text-admin-ink-secondary">
                  The style names a face for every role. The heading face has
                  curated alternates that stay inside the style; naming a role
                  outright leaves the curated set behind.
                </p>
                <div className="grid gap-sm sm:grid-cols-2">
                  {preset?.options?.headingFace
                    ? optionField('headingFace', preset.options.headingFace)
                    : null}
                  {THEME_FONT_ROLES.map((role) => (
                    <SelectField
                      key={role}
                      label={FONT_ROLE_LABELS[role] ?? `${role} font`}
                      value={form.fonts[role]}
                      options={[
                        { value: '', label: 'The style’s own face' },
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
                </div>
              </section>

              {/* ---------------------------------------- illustrations */}
              <section aria-labelledby="admin-theme-illustrations">
                <h3
                  id="admin-theme-illustrations"
                  className="font-admin-ui text-body font-semibold text-admin-ink"
                >
                  Illustrations
                </h3>
                <div className="mt-sm">
                  <SelectField
                    label="Illustration set"
                    value={form.motifSet}
                    options={[
                      {
                        value: '',
                        label: preset
                          ? `The style’s own set (${MOTIF_SET_LABELS[preset.motifSet] ?? preset.motifSet})`
                          : 'No illustrations',
                      },
                      ...MOTIF_SET_IDS.map((id) => ({
                        value: id,
                        label: MOTIF_SET_LABELS[id] ?? id,
                      })),
                    ]}
                    onChange={(value) => setForm((c) => ({ ...c, motifSet: value }))}
                    hint="Small drawings that carry a style's vocabulary. They take the page's own ink and never carry their own colour, and a page never shows more than three."
                    error={fieldErrors.get('theme.motifSet')}
                  />
                </div>
              </section>

              {/* --------------------------------- surface, shape, extras */}
              <section aria-labelledby="admin-theme-shape">
                <h3
                  id="admin-theme-shape"
                  className="font-admin-ui text-body font-semibold text-admin-ink"
                >
                  Surface and shape
                </h3>
                <div className="mt-sm grid gap-sm sm:grid-cols-2">
                  <SelectField
                    label="Surface"
                    value={form.texture}
                    options={[
                      { value: '', label: 'The style’s own surface' },
                      ...TEXTURE_IDS.map((id) => ({ value: id, label: TEXTURE_LABELS[id] ?? id })),
                    ]}
                    onChange={(value) => setForm((c) => ({ ...c, texture: value }))}
                    hint="Paper grain paints a faint dot pattern behind the page; flat removes it."
                    error={fieldErrors.get('theme.texture')}
                  />
                  <SelectField
                    label="Corners"
                    value={form.radius}
                    options={[
                      { value: '', label: 'The style’s own corners' },
                      ...RADIUS_IDS.map((id) => ({ value: id, label: RADIUS_LABELS[id] ?? id })),
                    ]}
                    onChange={(value) => setForm((c) => ({ ...c, radius: value }))}
                    error={fieldErrors.get('theme.radius')}
                  />
                  <SelectField
                    label="Spacing"
                    value={form.density}
                    options={[
                      { value: '', label: 'The style’s own spacing' },
                      ...DENSITY_IDS.map((id) => ({ value: id, label: DENSITY_LABELS[id] ?? id })),
                    ]}
                    onChange={(value) => setForm((c) => ({ ...c, density: value }))}
                    hint="How much room a page gives its content. Tight fits more on a screen; loose is easier to scan."
                    error={fieldErrors.get('theme.density')}
                  />
                  {advancedGroups.map((group) => optionField(group, preset.options[group]))}
                </div>
              </section>

              {/* -------------------------------- advanced color settings */}
              <section aria-labelledby="admin-theme-colors">
                <h3
                  id="admin-theme-colors"
                  className="font-admin-ui text-body font-semibold text-admin-ink"
                >
                  Advanced colour settings
                </h3>
                <p className="mb-sm mt-3xs max-w-[65ch] text-caption text-admin-ink-secondary">
                  Set any colour by hand, per mode. A value here wins over the
                  brand colour and over the style in that mode only; a blank
                  field keeps the worked-out value. Every pair is measured as
                  you type, and publishing a failing pair is refused.
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
                      className={overrideMode === mode ? primaryButtonClass : secondaryButtonClass}
                      onClick={() => setOverrideMode(mode)}
                    >
                      {mode === 'light' ? 'Light mode' : 'Dark mode'}
                    </button>
                  ))}
                </div>

                <div className="mt-sm grid gap-sm sm:grid-cols-2">
                  {THEME_COLOR_KEYS.map((key) => {
                    const failure = failureFor(overrideMode, key);
                    const derived = form.brandColor.trim() && DERIVED_COLOR_KEYS.includes(key);
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
                            : derived
                              ? 'Blank uses the shade worked out from the main brand colour.'
                              : undefined
                        }
                        error={fieldErrors.get(`theme.tokens.${overrideMode}.${key}`)}
                      />
                    );
                  })}
                </div>

                <div className="mt-sm">
                  <DestructiveConfirm
                    trigger={`Reset the ${overrideMode} colours`}
                    title={`Reset the ${overrideMode} colours`}
                    confirmLabel="Reset these colours"
                    consequence={`Every ${overrideMode}-mode colour you have set by hand goes, and that mode falls back to the shades worked out from the main brand colour, or to the style's own palette where there is none.`}
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
              </section>
            </div>
          </Panel>
        </div>

        {/* --------------------------------------------- the page preview */}
        <ThemeProof
          themeDoc={candidate}
          isDirty={isDirty}
          mode={previewMode}
          onModeChange={setPreviewMode}
        />
      </div>
    </form>
  );
}
