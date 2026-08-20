// Tailwind palette resolves through the theme chain (spec §7.2):
//   config/theme → generated theme.css :root custom properties (RGB triples)
//                → <style id="event-theme-runtime"> runtime override
//                → these brand-*/semantic utilities.
//
// No hex here, ever (spec §7.6). The rgb(var(--…-rgb) / <alpha-value>) form
// is what keeps opacity modifiers like bg-brand-primary/10 working.
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
      },
      fontFamily: {
        heading: 'var(--font-heading)',
        body: 'var(--font-body)',
        accent: 'var(--font-accent)',
      },
      borderRadius: {
        // config/theme.radius ('sharp' | 'soft' | 'round') sets --radius-base.
        brand: 'var(--radius-base)',
        'brand-lg': 'var(--radius-large)',
      },
    },
  },
  plugins: [],
};
