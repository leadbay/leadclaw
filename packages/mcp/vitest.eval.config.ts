import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

/**
 * Eval-tier vitest config — sequential execution (eng-review Performance #1).
 * Uses the same module resolution as vitest.config.ts (Node pnpm workspace
 * symlinks) so @leadbay/* packages resolve without manual aliases.
 * Sequential: singleThread=true (one test at a time, avoids API rate-limit races).
 */
export default defineConfig({
  define: {
    __LEADBAY_MCP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: "node",
    include: ["test/eval/**/*.eval.ts"],
    exclude: ["node_modules", "dist"],
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    testTimeout: 600_000, // 10 minutes per scenario
  },
});
