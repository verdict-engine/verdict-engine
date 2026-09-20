/**
 * Boundary enforcement — the rules the architecture depends on, made mechanical.
 *
 * A bounded context may import from:
 *   - itself (its own folder)
 *   - the shared kernel (@shared/*)
 *   - ANOTHER context's published contract ONLY: contexts/<x>/application/*.port.ts
 *
 * It may NEVER reach into another context's domain/, adapters/, or service impls.
 * That single restriction is what keeps the seams real: cross a boundary through a
 * port (synchronous) or an event (asynchronous) — never through a direct reference.
 */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["boundaries"],
  settings: {
    "boundaries/elements": [
      { type: "shared", pattern: "src/shared/*" },
      { type: "context", pattern: "src/contexts/*", capture: ["ctx"] },
    ],
  },
  rules: {
    // Layer direction: the shared kernel may never depend on a context.
    "boundaries/element-types": [
      "error",
      {
        default: "allow",
        rules: [{ from: "shared", disallow: ["context"], message: "The shared kernel must not depend on a context." }],
      },
    ],
    // The load-bearing invariant: a context may import ANOTHER context, but only
    // its published `application` surface (ports + contract types) — never its
    // internal domain/ or adapters/. This is what keeps every seam a real seam.
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["@contexts/*/domain/*", "@contexts/*/adapters/*"],
            message:
              "Cross a context boundary through its application/ contract (a *.port.ts or *.contracts.ts) or an event — never its domain or adapters.",
          },
        ],
      },
    ],
  },
};
