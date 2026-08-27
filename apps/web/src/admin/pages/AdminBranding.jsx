// Branding tab (issue #15 — "changing colors/logo in the Branding tab
// restyles the public site with no deploy"), wired to updateTheme.
//
// Editable: the palette (config/theme.colors), the four font roles from the
// bundled font-set allowlist (spec §7.4 — no arbitrary remote fonts), the
// texture treatment, the corner-radius scale, and the light/dark mode policy. Every change is previewed
// LIVE before saving by running the candidate document through the same
// lib/themeRuntime.js builder the runtime override uses, so what you see is
// what the public site will render — no deploy, no rebuild.
//
// Logo/asset slots: config/theme.logos holds PATHS into the Storage bucket,
// and each slot is an ImagePicker over the `branding/` namespace — browse
// the media library, upload a new file, or type a path by hand for an asset
// that predates the library (the four placeholders init seeds, or anything
// served from the bundle). Uploads go through `mediaUpload`, which verifies
// the admin token and writes with the Admin SDK; storage.rules still deny
// every client write to `branding/` (spec §8.5). Whatever is in `logos` is
// carried through every save verbatim.
//
// config/theme is a WHOLE-DOC replace, so the payload always carries colors,
// fonts, texture, radius, mode, and logos together.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import {
  DEFAULT_MODE_POLICY,
  FONT_SET_IDS,
  MODE_POLICY_IDS,
  RADIUS_IDS,
  THEME_COLOR_KEYS,
  THEME_COLOR_PROPERTIES,
  THEME_FONT_ROLES,
  TEXTURE_IDS,
  rgbTripleToHex,
} from '../../lib/themeRuntime.js';
import { applyThemePreview, clearThemePreview } from '../themePreview.js';
import {
  Panel,
  SaveStatus,
  SelectField,
  ServerErrorSummary,
  TextField,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import ImagePicker from '../../components/media/ImagePicker.jsx';

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
 * Seed one color input. config/theme.colors wins; otherwise the value
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

function toForm(theme) {
  const colors = {};
  for (const key of THEME_COLOR_KEYS) colors[key] = seedColor(theme?.colors, key);
  const fonts = {};
  for (const role of THEME_FONT_ROLES) {
    fonts[role] = FONT_SET_IDS.includes(theme?.fonts?.[role])
      ? theme.fonts[role]
      : FONT_SET_IDS[0];
  }
  const logos = {};
  for (const slot of LOGO_SLOTS) {
    logos[slot] = typeof theme?.logos?.[slot] === 'string' ? theme.logos[slot] : '';
  }
  return {
    colors,
    fonts,
    logos,
    texture: TEXTURE_IDS.includes(theme?.texture) ? theme.texture : TEXTURE_IDS[0],
    radius: RADIUS_IDS.includes(theme?.radius) ? theme.radius : RADIUS_IDS[1] ?? RADIUS_IDS[0],
    // A stored document that predates the mode policy has no `mode`, and
    // light is what it renders, so light is what the form starts on.
    mode: MODE_POLICY_IDS.includes(theme?.mode) ? theme.mode : DEFAULT_MODE_POLICY,
  };
}

/** The candidate config/theme doc — blank colors are omitted, not sent empty. */
function toThemeDoc(form) {
  const colors = {};
  for (const [key, value] of Object.entries(form.colors)) {
    if (typeof value === 'string' && value.trim()) colors[key] = value.trim();
  }
  const logos = {};
  for (const [slot, value] of Object.entries(form.logos)) {
    if (typeof value === 'string' && value.trim()) logos[slot] = value.trim();
  }
  return {
    colors,
    fonts: { ...form.fonts },
    logos,
    texture: form.texture,
    radius: form.radius,
    mode: form.mode,
  };
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

const RADIUS_LABELS = { sharp: 'Sharp', soft: 'Soft', round: 'Round' };
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

export default function AdminBranding() {
  const { theme, sources } = useEventConfig();
  const call = useAdminApi();
  const { showToast } = useToast();

  const [form, setForm] = useState(() => toForm(theme));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const errorRef = useRef(null);
  const adoptedRef = useRef(sources.theme === 'live');

  // Seeding reads unset colors back from the resolved custom properties, so
  // the preview overlay must be gone first — otherwise a color the saved
  // theme does not set would "revert" to the unsaved candidate that is
  // currently painting the page. The preview effect below re-applies from the
  // fresh form on the next render.
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

  // Live preview: candidate values are applied to the page on every change
  // and removed when the tab unmounts, so an abandoned edit leaves nothing
  // behind and the saved theme renders again.
  useEffect(() => {
    applyThemePreview(candidate);
  }, [candidate]);
  useEffect(() => () => clearThemePreview(), []);

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

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setStatus('');
    try {
      await call('updateTheme', { theme: candidate });
      setStatus('Saved. The public site restyles live — no deploy needed.');
      showToast('Branding saved.');
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
    <form className="flex flex-col gap-6" onSubmit={submit}>
      <div>
        <h1 className="font-heading text-2xl font-semibold text-brand-ink">Branding</h1>
        <p className="text-sm text-brand-ink-muted">
          Colors, type, and texture. Changes preview on this page immediately;
          saving applies them to the public site without a deploy.
        </p>
      </div>

      <ServerErrorSummary error={error} errorRef={errorRef} />
      {status ? <SaveStatus message={status} /> : null}

      <Panel
        title="Palette"
        description="Hex colors. A color left blank falls back to the build-time palette."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {THEME_COLOR_KEYS.map((key) => (
            <div key={key} className="flex items-end gap-3">
              {toPickerHex(form.colors[key]) ? (
                <input
                  type="color"
                  aria-label={`${COLOR_LABELS[key] ?? key} color picker`}
                  value={toPickerHex(form.colors[key])}
                  onChange={(event) =>
                    setForm((c) => ({ ...c, colors: { ...c.colors, [key]: event.target.value } }))
                  }
                  className="touch-target h-11 w-14 rounded-brand border border-brand-ink/20 bg-brand-surface p-1"
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
      </Panel>

      <Panel
        title="Type, texture, and shape"
        description="Font sets are bundled and self-hosted; only these three are available."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {THEME_FONT_ROLES.map((role) => (
            <SelectField
              key={role}
              label={FONT_ROLE_LABELS[role] ?? `${role} font`}
              value={form.fonts[role]}
              options={FONT_SET_IDS.map((id) => ({
                value: id,
                label: FONT_SET_LABELS[id] ?? id,
              }))}
              onChange={(value) =>
                setForm((c) => ({ ...c, fonts: { ...c.fonts, [role]: value } }))
              }
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
          <SelectField
            label="Light or dark"
            value={form.mode}
            options={MODE_POLICY_IDS.map((id) => ({ value: id, label: MODE_LABELS[id] ?? id }))}
            onChange={(value) => setForm((c) => ({ ...c, mode: value }))}
            hint="Every theme defines both. Follow the reader lets each visitor’s own setting decide."
          />
        </div>
      </Panel>

      <Panel title="Preview" description="These samples use the same tokens the public site does.">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-brand bg-brand-primary px-4 py-2 font-semibold text-brand-surface">
            Primary action
          </span>
          <span className="rounded-brand bg-brand-accent px-4 py-2 font-semibold text-brand-surface">
            Accent
          </span>
          <span className="rounded-brand border border-brand-ink/20 bg-brand-surface-alt px-4 py-2 text-brand-ink">
            Surface
          </span>
          <span className="rounded-brand bg-success/10 px-3 py-2 text-success">Success</span>
          <span className="rounded-brand bg-warning/10 px-3 py-2 text-warning">Warning</span>
          <span className="rounded-brand bg-danger/10 px-3 py-2 text-danger">Danger</span>
        </div>
        <p className="mt-4 font-heading text-2xl text-brand-ink">Heading typeface</p>
        <p className="font-body text-brand-ink">
          Body typeface — the face most of the site is set in.
        </p>
        <p className="font-data text-brand-ink">
          Data typeface — captions, labels, and the lines beside the text.
        </p>
        <p className="font-mono tabular-nums text-brand-ink">
          Mono typeface — 09:30 · Room B2 · 148 seats
        </p>
      </Panel>

      <Panel
        title="Logos and assets"
        description="Each slot points at a file in the media library. Choose an existing file or upload a new one."
      >
        <div className="grid gap-6 sm:grid-cols-2">
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

      <div className="flex flex-wrap gap-3">
        <button type="submit" className={primaryButtonClass} disabled={saving}>
          {saving ? 'Saving…' : 'Save branding'}
        </button>
        <button type="button" className={secondaryButtonClass} onClick={revert} disabled={saving}>
          Revert to saved
        </button>
      </div>
    </form>
  );
}
