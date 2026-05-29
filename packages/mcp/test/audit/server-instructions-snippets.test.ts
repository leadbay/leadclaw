import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as generated from "../../src/server-instructions.generated.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const SNIPPETS_DIR = join(
  REPO_ROOT,
  "packages",
  "promptforge",
  "snippets",
  "server-instructions",
);
const SERVER_TS = join(REPO_ROOT, "packages", "mcp", "src", "server.ts");

function snippetFiles(): string[] {
  return readdirSync(SNIPPETS_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();
}

function constName(file: string): string {
  return file.replace(/\.md$/, "").replace(/-/g, "_").toUpperCase();
}

describe("audit: server-instructions snippets", () => {
  it("snippets dir exists and is non-empty", () => {
    expect(existsSync(SNIPPETS_DIR)).toBe(true);
    expect(snippetFiles().length).toBeGreaterThan(0);
  });

  it("every snippet has a matching exported const in server-instructions.generated.ts", () => {
    const missing: string[] = [];
    for (const file of snippetFiles()) {
      const name = constName(file);
      if (!(name in generated)) missing.push(`${name} (from ${file})`);
    }
    expect(missing, `missing exports — run "pnpm prompts:build"`).toEqual([]);
  });

  it("every exported const matches the snippet body verbatim (trim-trailing)", () => {
    const drifted: string[] = [];
    for (const file of snippetFiles()) {
      const name = constName(file);
      const fromDisk = readFileSync(join(SNIPPETS_DIR, file), "utf8").trimEnd();
      const fromCode = (generated as Record<string, string>)[name];
      if (fromDisk !== fromCode) drifted.push(`${name}: snippet diverges from generated const`);
    }
    expect(drifted, `regen with "pnpm prompts:build"`).toEqual([]);
  });

  it("server.ts imports every snippet's const by name", () => {
    const src = readFileSync(SERVER_TS, "utf8");
    const importMatch = src.match(
      /from\s+["']\.\/server-instructions\.generated\.js["']/,
    );
    expect(importMatch, "server.ts must import from ./server-instructions.generated.js").toBeTruthy();
    const missing: string[] = [];
    for (const file of snippetFiles()) {
      const name = constName(file);
      // The import statement at the top names the const, AND buildServerInstructions
      // references it. Asserting the bare identifier appears at least twice catches
      // "imported but unused" as well as "renamed but not wired".
      const occurrences = (src.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
      if (occurrences < 2) {
        missing.push(`${name} (${occurrences} occurrence(s) in server.ts; expected import + usage)`);
      }
    }
    expect(missing).toEqual([]);
  });
});
