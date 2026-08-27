// Tailwind maps utilities onto the design tokens (spec §7.2, design brief
// §3.6 and §3.7):
//   design/tokens/*.json → scripts/lib/tokens.cjs
//                        → generated theme.css custom properties
//                        → <style id="event-theme-runtime"> runtime override
//                        → data-mode on <html> picks the mode block
//                        → these utilities.
//
// No hex here, ever (spec §7.6). The rgb(var(--…-rgb) / <alpha-value>) form
// is what keeps opacity modifiers like bg-brand-primary/10 working.
//
// Everything below EXTENDS the Tailwind defaults rather than replacing them.
// This branch restyles the public pages, the block renderers, and the
// editorial devices onto the token utilities. The admin panel, the shared
// media widgets, and the toast are still on the brand-* names and the
// default Tailwind sizes; leaving the defaults in place keeps those
// compiling and rendering until PR2 moves them over.
const fontStep = (step) => [
  `var(--text-${step})`,
  { lineHeight: `var(--text-${step}-leading)`, letterSpacing: `var(--text-${step}-tracking)` },
];

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        'brand-primary': 'rgb(var(--brand-primary-rgb) / <alpha-value>)',
        'brand-primary-dark': 'rgb(var(--brand-primary-dark-rgb) / <alpha-value>)',
        'brand-primary-light': 'rgb(var(--brand-primary-light-rgb) / <alpha-value>)',
        'brand-accent': 'rgb(var(--brand-accent-rgb) / <alpha-value>)',
        'brand-surface': 'rgb(var(--brand-surface-rgb) / <alpha-value>)',
        'brand-surface-alt': 'rgb(var(--brand-surface-alt-rgb) / <alpha-value>)',
        'brand-ink': 'rgb(var(--brand-ink-rgb) / <alpha-value>)',
        'brand-ink-muted': 'rgb(var(--brand-ink-muted-rgb) / <alpha-value>)',
        // Semantic tokens (spec §7.2) — role names, never appearance names.
        success: 'rgb(var(--semantic-success-rgb) / <alpha-value>)',
        warning: 'rgb(var(--semantic-warning-rgb) / <alpha-value>)',
        danger: 'rgb(var(--semantic-danger-rgb) / <alpha-value>)',
        highlight: 'rgb(var(--semantic-highlight-rgb) / <alpha-value>)',
        keynote: 'rgb(var(--semantic-keynote-rgb) / <alpha-value>)',
        // Tier 2 role names (brief §3.1). Every public surface reads these;
        // the brand-* names above stay for the surfaces PR2 still moves.
        surface: 'rgb(var(--color-surface-rgb) / <alpha-value>)',
        'surface-alt': 'rgb(var(--color-surface-alt-rgb) / <alpha-value>)',
        'text-primary': 'rgb(var(--color-text-primary-rgb) / <alpha-value>)',
        'text-secondary': 'rgb(var(--color-text-secondary-rgb) / <alpha-value>)',
        accent: 'rgb(var(--color-accent-rgb) / <alpha-value>)',
        'accent-strong': 'rgb(var(--color-accent-strong-rgb) / <alpha-value>)',
        'accent-soft': 'rgb(var(--color-accent-soft-rgb) / <alpha-value>)',
        'accent-secondary': 'rgb(var(--color-accent-secondary-rgb) / <alpha-value>)',
        'ink-motif': 'rgb(var(--color-ink-motif-rgb) / <alpha-value>)',
        // Rule colors (brief §3.7). Rules are structure, so they get their
        // own tokens instead of borrowing an ink step.
        'rule-hairline': 'rgb(var(--rule-hairline-rgb) / <alpha-value>)',
        'rule-strong': 'rgb(var(--rule-strong-rgb) / <alpha-value>)',
        'rule-nameplate': 'rgb(var(--rule-nameplate-rgb) / <alpha-value>)',
        // A form control's boundary (input, select, textarea) needs 3:1
        // against its ground (WCAG 1.4.11) — the hairline share falls well
        // short of that, so control borders get their own token.
        control: 'rgb(var(--color-border-control-rgb) / <alpha-value>)',
      },
      fontFamily: {
        heading: 'var(--font-heading)',
        body: 'var(--font-body)',
        data: 'var(--font-data)',
        mono: 'var(--font-mono)',
        // Retired role, kept for one release as an alias of --font-heading
        // (brief §3.2). PR2 removes it.
        accent: 'var(--font-accent)',
      },
      // The fluid editorial scale (brief §3.7). Eight steps, each carrying
      // its own line height and tracking: text-nameplate, text-h1, text-h2,
      // text-h3, text-lead, text-body, text-caption, text-folio.
      fontSize: {
        folio: fontStep('folio'),
        caption: fontStep('caption'),
        body: fontStep('body'),
        lead: fontStep('lead'),
        h3: fontStep('h3'),
        h2: fontStep('h2'),
        h1: fontStep('h1'),
        nameplate: fontStep('nameplate'),
      },
      // The named weights (--weight-regular … --weight-bold) are NOT mapped
      // here on purpose: font-medium, font-semibold, and font-bold already
      // exist in Tailwind at exactly those values, and remapping them would
      // put every existing component's weight behind a custom property for
      // no gain. Read the tokens directly from CSS where a contract needs one.
      // The spacing scale (brief §3.7). Named steps sit beside Tailwind's
      // numeric ones, so p-md and gap-lg work without breaking p-4.
      spacing: {
        '3xs': 'var(--space-3xs)',
        '2xs': 'var(--space-2xs)',
        xs: 'var(--space-xs)',
        sm: 'var(--space-sm)',
        md: 'var(--space-md)',
        lg: 'var(--space-lg)',
        xl: 'var(--space-xl)',
        '2xl': 'var(--space-2xl)',
        '3xl': 'var(--space-3xl)',
      },
      borderWidth: {
        hairline: 'var(--rule-hairline-width)',
        strong: 'var(--rule-strong-width)',
        nameplate: 'var(--rule-nameplate-width)',
      },
      borderRadius: {
        // config/theme.radius ('sharp' | 'soft' | 'round') sets --radius-base.
        brand: 'var(--radius-base)',
        'brand-lg': 'var(--radius-large)',
      },
      transitionDuration: {
        fast: 'var(--motion-fast)',
        base: 'var(--motion-base)',
        slow: 'var(--motion-slow)',
        signature: 'var(--motion-signature)',
      },
      transitionTimingFunction: {
        motion: 'var(--motion-ease)',
      },
    },
  },
  plugins: [],
};
