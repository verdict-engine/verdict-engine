/**
 * The app version surfaced to clients (/health, /readyz, Swagger). The image doesn't ship
 * package.json, so this is the runtime constant. It must equal package.json's "version" — version.spec.ts
 * fails CI if they drift, making package.json the single source of truth on every release.
 */
export const APP_VERSION = "0.7.0";
