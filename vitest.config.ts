import { resolve } from "node:path";
import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

const root = process.cwd();

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.spec.ts", "test/**/*.e2e-spec.ts"],
    hookTimeout: 20000,
  },
  resolve: {
    alias: {
      "@shared": resolve(root, "src/shared"),
      "@contexts": resolve(root, "src/contexts"),
    },
  },
  plugins: [
    // SWC transforms decorators + emits metadata so NestJS DI works in e2e tests.
    swc.vite({
      jsc: {
        target: "es2021",
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
