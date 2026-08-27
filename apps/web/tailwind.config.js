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
// The restyle lands in a later pull request, so components still on default
// Tailwind classes keep compiling and rendering while the token utilities
// come into use beside them.
const fontStep = (step) => [
  `var(--text-${step})`,
  { lineHeight: `var(--text-${step}-leading)`, letterSpacing: `var(--text-${step}-tracking)` },
];

export default {
  // TESTS ARE NOT CONTENT, AND ONE OF THEM DEPENDS ON THAT.
  //
  // Tailwind tree-shakes anything in `@layer components` whose class name it
  // cannot find in the files it scans, and `src/**/*.{js,jsx}` scanned the
  // test files too. src/components/editorial/purge.test.js exists to catch
  // exactly that tree-shaking — and it works by listing every device class
  // as a literal string. Scanning it made every class on that list survive
  // BECAUSE the test named it, so the test could not fail for anything it
  // checked. A class no component used still shipped, and a class a
  // component stopped using went on shipping.
  //
  // Excluding the tests makes the build reflect the app alone, which is
  // what the test was written to measure.
  content: ['./index.html', './src/**/*.{js,jsx}', '!./src/**/*.test.{js,jsx}'],
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
        // Tier 2 role names (brief §3.1). The restyle moves components onto
        // these; the brand-* names above stay until it does.
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
        // The admin identity (admin story part 6). A separate family on
        // purpose: the admin obeys data-mode and ignores data-theme, so an
        // admin utility must never resolve to a client's brand token. The
        // client accent itself is NOT mapped here — only the two component
        // tokens that are allowed to carry it, which is what makes "the
        // accent appears in exactly two places" greppable.
        'admin-ground': 'rgb(var(--admin-ground-rgb) / <alpha-value>)',
        'admin-ground-raised': 'rgb(var(--admin-ground-raised-rgb) / <alpha-value>)',
        'admin-ground-proof': 'rgb(var(--admin-ground-proof-rgb) / <alpha-value>)',
        'admin-ground-input': 'rgb(var(--admin-ground-input-rgb) / <alpha-value>)',
        'admin-ground-alarm': 'rgb(var(--admin-ground-alarm-rgb) / <alpha-value>)',
        'admin-ink': 'rgb(var(--admin-ink-rgb) / <alpha-value>)',
        'admin-ink-secondary': 'rgb(var(--admin-ink-secondary-rgb) / <alpha-value>)',
        'admin-ink-data': 'rgb(var(--admin-ink-data-rgb) / <alpha-value>)',
        'admin-ink-inverse': 'rgb(var(--admin-ink-inverse-rgb) / <alpha-value>)',
        'admin-ink-disabled': 'rgb(var(--admin-ink-disabled-rgb) / <alpha-value>)',
        'admin-ink-link': 'rgb(var(--admin-ink-link-rgb) / <alpha-value>)',
        'admin-rule-hairline': 'rgb(var(--admin-rule-hairline-rgb) / <alpha-value>)',
        'admin-rule-strong': 'rgb(var(--admin-rule-strong-rgb) / <alpha-value>)',
        'admin-rule-header': 'rgb(var(--admin-rule-header-rgb) / <alpha-value>)',
        'admin-rule-alarm': 'rgb(var(--admin-rule-alarm-rgb) / <alpha-value>)',
        'admin-state-live': 'rgb(var(--admin-state-live-rgb) / <alpha-value>)',
        'admin-state-draft': 'rgb(var(--admin-state-draft-rgb) / <alpha-value>)',
        'admin-state-error': 'rgb(var(--admin-state-error-rgb) / <alpha-value>)',
        'admin-state-caution': 'rgb(var(--admin-state-caution-rgb) / <alpha-value>)',
        'admin-state-ok': 'rgb(var(--admin-state-ok-rgb) / <alpha-value>)',
        'admin-focus-ring': 'rgb(var(--admin-focus-ring-rgb) / <alpha-value>)',
        // The two client-accent slots, and the only two (admin story part 6f).
        'admin-nav-active-marker': 'rgb(var(--admin-nav-active-marker-rgb) / <alpha-value>)',
        'admin-page-header-mark': 'rgb(var(--admin-page-header-mark-rgb) / <alpha-value>)',
      },
      fontFamily: {
        heading: 'var(--font-heading)',
        body: 'var(--font-body)',
        data: 'var(--font-data)',
        mono: 'var(--font-mono)',
        // The admin runs two faces where a preset runs four (admin story
        // part 6g): the UI face carries everything a person reads as
        // language, the data face everything the machine owns. Neither is
        // writable from config/theme.
        'admin-ui': 'var(--admin-font-ui)',
        'admin-data': 'var(--admin-font-data)',
        // There is no `accent` face. PR2 removed the retired --font-accent
        // alias (brief §3.2, §7). Zine's handwritten callout runs on the
        // --callout-font component token, which the callout component reads
        // directly rather than through a utility.
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
        // Each admin rule ships as a colour plus a width pair (brief §3.7).
        'admin-hairline': 'var(--admin-rule-hairline-width)',
        'admin-strong': 'var(--admin-rule-strong-width)',
        'admin-header': 'var(--admin-rule-header-width)',
        'admin-alarm': 'var(--admin-rule-alarm-width)',
        'admin-marker': 'var(--admin-nav-active-marker-width)',
      },
      borderRadius: {
        // config/theme.radius ('sharp' | 'soft' | 'round') sets --radius-base.
        brand: 'var(--radius-base)',
        'brand-lg': 'var(--radius-large)',
        // One radius for the whole room, and there is no second one: this is
        // what stops a pill arriving in the admin (admin story part 6g).
        admin: 'var(--admin-radius)',
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
