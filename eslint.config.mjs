import { FlatCompat } from "@eslint/eslintrc";
import { fileURLToPath } from "node:url";

const compat = new FlatCompat({ baseDirectory: fileURLToPath(new URL(".", import.meta.url)) });
const config = [
  { ignores: [".next/**", "next-env.d.ts", "node_modules/**", ".test-state/**", "test-results/**", "playwright-report/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // Literal apostrophes in prose are intentional throughout the existing UI.
  { rules: { "react/no-unescaped-entities": "off" } },
];

export default config;
