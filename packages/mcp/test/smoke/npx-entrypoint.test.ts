/**
 * Regression guard for issue #3504: under `npx`, process.argv[1] points at
 * a shim symlink (e.g. ~/.npm/_npx/<hash>/.../bin/leadbay-mcp) while
 * import.meta.url resolves to the actual dist/bin.js path. The old
 * isEntrypoint check compared paths literally and silently exited 0.
 *
 * This test simulates the npx layout with a symlink and asserts the binary
 * actually starts. Without the realpath fix in bin.ts, this test fails:
 * exit 0, empty stdout. With the fix, --help is printed.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, "..", "..", "dist", "bin.js");

const hasBuild = existsSync(BIN);
if (!hasBuild) {
  console.log(`[smoke] SMOKE_SKIPPED: missing built bin at ${BIN} — run pnpm build first`);
}

describe.skipIf(!hasBuild)("@leadbay/mcp — npx-shim entrypoint detection", () => {
  it("prints --help when invoked through a symlink (the npx shim path)", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "leadbay-mcp-npx-"));
    const binDir = path.join(tmp, ".bin");
    mkdirSync(binDir, { recursive: true });
    const shim = path.join(binDir, "leadbay-mcp");
    symlinkSync(BIN, shim);

    try {
      const { code, stdout, stderr } = await runNode(shim, ["--help"]);
      // Without the realpath fix, this is `code=0, stdout=""` (the bug).
      // The regression guard: stdout must contain HELP text identifiers.
      expect(code, `nonzero exit; stderr=${stderr}`).toBe(0);
      expect(stdout, "empty stdout = isEntrypoint check failed (regression of #3504)").not.toBe("");
      expect(stdout).toMatch(/leadbay-mcp/);
      expect(stdout).toMatch(/LEADBAY_TOKEN/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("still works when invoked directly (no regression for the path Rémi already had working)", async () => {
    const { code, stdout, stderr } = await runNode(BIN, ["--help"]);
    expect(code, `nonzero exit; stderr=${stderr}`).toBe(0);
    expect(stdout).toMatch(/leadbay-mcp/);
    expect(stdout).toMatch(/LEADBAY_TOKEN/);
  });
});

function runNode(entry: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("node", [entry, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}
