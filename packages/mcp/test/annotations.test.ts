/**
 * Annotations test — asserts MCP-spec ToolAnnotations land in the
 * tools/list payload for tools that declare them.
 *
 * Per MCP 2025-11-25 §Tools, annotations are HINTS — clients use them
 * to decide UX (auto-approve vs prompt). The Tool type in core carries
 * an optional `annotations` field; toolsListPayload surfaces it on the
 * wire when present.
 *
 * This test pins the canonical annotations for two representative
 * composites — pull_leads (read) and report_outreach (destructive,
 * non-idempotent). Subsequent iterations will add per-tool assertions
 * for the remaining tools as their annotations land.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";

async function connect() {
  const lbClient = new LeadbayClient(BASE, "u.test-token");
  const server = buildServer(lbClient, { includeWrite: true });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return { mcpClient };
}

beforeEach(() => {
  resetHttpMock();
});

describe("every composite tool has annotations (drift catcher)", () => {
  it("every default-surface composite (read + write) declares annotations", async () => {
    const { mcpClient } = await connect();
    const listed = await mcpClient.listTools();
    // The default surface (with includeWrite=true) is composite reads
    // + composite writes. EVERY tool must declare annotations.
    const missing: string[] = [];
    for (const t of listed.tools) {
      if (!t.annotations) {
        missing.push(t.name);
      }
    }
    expect(missing, `tools missing annotations: ${missing.join(", ")}`).toEqual([]);
  });

  it("every annotated tool sets at least one of the four hints", async () => {
    const { mcpClient } = await connect();
    const listed = await mcpClient.listTools();
    const HINT_KEYS = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"];
    const missingHints: string[] = [];
    for (const t of listed.tools) {
      if (!t.annotations) continue;
      const hasAny = HINT_KEYS.some((k) => k in (t.annotations as Record<string, unknown>));
      if (!hasAny) missingHints.push(t.name);
    }
    expect(missingHints).toEqual([]);
  });

  it("destructive tools that mutate state are flagged readOnlyHint:false", async () => {
    const { mcpClient } = await connect();
    const listed = await mcpClient.listTools();
    const destructiveNames = [
      "leadbay_report_outreach",
      "leadbay_bulk_qualify_leads",
      "leadbay_enrich_titles",
      "leadbay_adjust_audience",
      "leadbay_refine_prompt",
      "leadbay_answer_clarification",
      "leadbay_import_leads",
      "leadbay_import_and_qualify",
    ];
    for (const name of destructiveNames) {
      const t = listed.tools.find((tool) => tool.name === name);
      expect(t, `${name} not found`).toBeDefined();
      expect(t!.annotations).toBeDefined();
      expect(t!.annotations!.destructiveHint, `${name} destructiveHint`).toBe(true);
      expect(t!.annotations!.readOnlyHint, `${name} readOnlyHint`).toBe(false);
    }
  });
});

describe("tools/list annotations (MCP spec ToolAnnotations)", () => {
  it("leadbay_pull_leads is annotated readOnly + idempotent + openWorld", async () => {
    const { mcpClient } = await connect();
    const listed = await mcpClient.listTools();
    const t = listed.tools.find((tool) => tool.name === "leadbay_pull_leads");
    expect(t).toBeDefined();
    expect(t!.annotations).toEqual({
      title: "Pull fresh Leadbay leads",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });

  it("leadbay_report_outreach is annotated destructive + non-idempotent + openWorld", async () => {
    const { mcpClient } = await connect();
    const listed = await mcpClient.listTools();
    const t = listed.tools.find((tool) => tool.name === "leadbay_report_outreach");
    expect(t).toBeDefined();
    expect(t!.annotations).toEqual({
      title: "Report outreach to Leadbay",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  it("research_lead is annotated readOnly + idempotent + openWorld (extended in iter 2)", async () => {
    const { mcpClient } = await connect();
    const listed = await mcpClient.listTools();
    const t = listed.tools.find((tool) => tool.name === "leadbay_research_lead");
    expect(t).toBeDefined();
    expect(t!.annotations).toEqual({
      title: "Research a Leadbay lead in depth",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });
});
