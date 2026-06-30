import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";

// Next 16 removed `next lint`, and this project never had a standalone ESLint
// config — linting was effectively off. eslint-config-next's legacy preset
// crashes the eslint-9 FlatCompat bridge, so this is a native flat config:
// typescript-eslint + the react-hooks and @next/next plugins (the latter two
// are registered mainly so the codebase's existing inline
// `eslint-disable react-hooks/* | @next/next/*` comments resolve instead of
// erroring as "rule definition not found" — and as a bonus restore that
// coverage).
//
// Posture: lint is ADVISORY (CI runs it continue-on-error). Rules that flood a
// large pre-existing codebase are "warn", so the command exits 0 and surfaces a
// backlog rather than failing on day one. Promote back to "error" as cleared.
export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "scripts/**", // Python shims + node helpers, not app source
      "*.config.*",
      "public/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "react-hooks": reactHooks,
      "@next/next": nextPlugin,
    },
    rules: {
      // tsc is the source of truth for these; the core-rule versions only
      // false-positive on TS / browser / node globals.
      "no-undef": "off",
      "no-unused-vars": "off",
      // High-noise on existing code → warnings (the backlog to burn down).
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/rules-of-hooks": "warn",
      "@next/next/no-img-element": "warn",
      "no-empty": "warn",
      "prefer-const": "warn",
      "no-useless-escape": "warn",
      "no-misleading-character-class": "warn",
      "no-loss-of-precision": "warn",
      "no-control-regex": "warn",
    },
  },
);
