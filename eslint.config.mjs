// ESLint flat config for the workspace (spec §7.6, §8.1).
//
// Two repo-specific enforcement points, both from the CJS2026 postmortem:
//   1. The hex sweep — no hex color literals outside the three allowlisted
//      paths. Ported code converts hex to theme tokens; a new literal fails CI.
//   2. react-hooks/rules-of-hooks — the incident class the frontend port
//      must not reintroduce.
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

// Matches #rgb, #rgba, #rrggbb, #rrggbbaa in string literals, template
// strings, and JSX attribute values (JSX attribute values are Literals).
const HEX_LITERAL = "#[0-9a-fA-F]{3,8}\\b";

const noHexLiterals = {
  "no-restricted-syntax": [
    "error",
    {
      selector: `Literal[value=/${HEX_LITERAL}/]`,
      message:
        "Hex color literals are banned outside the spec §7.6 allowlist. Use theme tokens (custom properties) instead.",
    },
    {
      selector: `TemplateElement[value.raw=/${HEX_LITERAL}/]`,
      message:
        "Hex color literals are banned outside the spec §7.6 allowlist. Use theme tokens (custom properties) instead.",
    },
  ],
};

export default [
  {
    ignores: [
      // Harness-managed session state (gitignored); may hold agent worktrees.
      ".claude/",
      "**/node_modules/",
      "**/dist/",
      "coverage/",
      "docs/",
      "functions/vendor/",
      // Third allowlist path of spec §7.6. ESLint does not lint CSS, but the
      // path is recorded here so the allowlist reads complete.
      "apps/web/src/generated/theme.css",
    ],
  },
  js.configs.recommended,
  {
    rules: {
      // `const { OMITTED, ...rest } = obj` is the standard omit idiom.
      "no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },

  // CommonJS surfaces: shared package, functions, operator scripts.
  {
    files: ["**/*.cjs", "functions/**/*.js", "scripts/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: { ...noHexLiterals },
  },

  // ESM surfaces: shims, configs, scripts, tests.
  {
    files: ["**/*.mjs", "**/*.js"],
    // apps/web is excluded so frontend files only get the browser-globals
    // JSX block below — Node globals must not pass no-undef there.
    ignores: ["functions/**/*.js", "scripts/**/*.js", "apps/web/**"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: { ...noHexLiterals },
  },

  // Frontend: JSX plus the rules-of-hooks guard.
  {
    files: ["apps/web/**/*.{js,jsx,mjs}"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...noHexLiterals,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // Spec §7.6 allowlist: mail clients need literal hex, and the schedule PDF
  // builds numeric RGB (values still come from config).
  {
    files: ["functions/src/email/templates/**", "functions/src/schedule/pdf.cjs"],
    rules: { "no-restricted-syntax": "off" },
  },
];
