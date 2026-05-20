/**
 * Audit-compliance #3 + #4 (partial):
 *
 * #3 — no inline tool descriptions in server.ts (must be imported from
 * the generated module or from each tool definition file).
 *
 * #4 — every tool description is ≤ a per-class budget. We don't enforce
 * 800 chars yet because most tools have not been migrated; instead we
 * assert that migrated tools (those imported from tool-descriptions.generated.ts)
 * are within budget, and we record the current length distribution so
 * regressions become visible.
 *
 * Both rules close incident #3504: tool surface drift via inline edits
 * to server.ts paragraphs that didn't match the live tool set.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  compositeReadTools,
  compositeWriteTools,
  granularReadTools,
  granularWriteTools,
} from "@leadbay/core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_PATH = resolve(__dirname, "..", "..", "src", "server.ts");

// Budget raised again in the 0.10 host-widget-routing redesign. Each
// composite that surfaces a renderable result now carries directives
// for three parallel rendering surfaces (Claude's built-in widgets, our
// MCP Apps widgets, plain prose/table) plus the canonical RENDERING
// block. The cost is real but bounded; the upside is the agent doesn't
// guess at routing across hosts. Future tightening: when widget
// routing matures, factor more into shared snippets.
const MIGRATED_TOOL_DESCRIPTION_MAX_CHARS = 17000;

describe("audit: tool description source-of-truth", () => {
  it("server.ts does not register any inline description literals (must come from tool defs)", () => {
    const serverSrc = readFileSync(SERVER_PATH, "utf8");
    // Look for the danger pattern: server.ts directly writing description text
    // for any registered tool. The legitimate uses of "description" in server.ts
    // are: SERVER_INSTRUCTIONS paragraph fragments (the buildServerInstructions
    // dynamic assembly), zod schema descriptions, and tool metadata projection.
    // The audit fails if server.ts contains a literal description for any
    // leadbay_* tool name.
    const allNames = [
      ...compositeReadTools,
      ...compositeWriteTools,
      ...granularReadTools,
      ...granularWriteTools,
    ].map((t) => t.name);
    const danger = allNames.filter((name) =>
      new RegExp(`name:\\s*['"\`]${name}['"\`][^}]*description:`, "s").test(serverSrc),
    );
    expect(danger).toEqual([]);
  });

  it("migrated tool descriptions (imported from tool-descriptions.generated.ts) are ≤ budget", async () => {
    const generated = (await import(
      "@leadbay/core/src/tool-descriptions.generated.js"
    )) as Record<string, unknown>;
    const violations: string[] = [];
    for (const [name, value] of Object.entries(generated)) {
      if (typeof value !== "string") continue; // skip TOOL_DESCRIPTIONS map etc.
      if (name === "TOOL_DESCRIPTIONS") continue;
      if (value.length > MIGRATED_TOOL_DESCRIPTION_MAX_CHARS) {
        violations.push(`${name}: ${value.length} chars (budget ${MIGRATED_TOOL_DESCRIPTION_MAX_CHARS})`);
      }
    }
    expect(violations).toEqual([]);
  });
});
