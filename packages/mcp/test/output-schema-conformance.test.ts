/**
 * outputSchema ↔ structuredContent conformance — the drift-catcher (iter17).
 *
 * Two prior bugs in this run had the same shape:
 *   - iter-13: research_lead.outputSchema declared one shape; live return had
 *     different keys at the top level. The SDK didn't notice. The
 *     fresh-context second-opinion subagent did, on a delay.
 *   - iter-16: report_outreach.outputSchema declared the dry-run shape; the
 *     live (non-dry) path returned different keys. Same defect class.
 *
 * This test enrolls every Tool with an outputSchema by walking the exported
 * composite catalogues, calls each via the in-process MCP client with mocked
 * HTTP, and asserts:
 *   1. structuredContent is emitted (server.ts only emits for plain-object,
 *      non-error returns — so we must trigger the success path).
 *   2. Every key listed in outputSchema.required is present in the return.
 *   3. Every key in the return is declared in outputSchema.properties.
 *   4. (Recursive demo: research_lead.engagement nested keys validated against
 *      the nested schema, proving the pattern extends.)
 *
 * The meta-test asserts every outputSchema-declarer has a registered mock —
 * adding a new outputSchema without a conformance mock fails the test.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import {
  LeadbayClient,
  compositeReadTools,
  compositeWriteTools,
  type Tool,
} from "@leadbay/core";
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

// -----------------------------------------------------------------------
// Conformance asserter — minimal subset of JSON Schema validation focused
// on the bug class (top-level required + no-undeclared-keys).
//
// Why not Ajv? Ajv would handle the full spec (types, formats, pattern,
// oneOf, etc.) but the bug class is "wrong top-level keys" not "wrong type
// for a deeply nested int". A 30-LoC custom validator catches the class
// without taking a runtime dep. Future iters can promote to Ajv if needed.
// -----------------------------------------------------------------------

interface JSONSchemaLike {
  type?: string | string[];
  properties?: Record<string, JSONSchemaLike>;
  required?: string[];
  items?: JSONSchemaLike;
  description?: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function assertConforms(
  value: unknown,
  schema: JSONSchemaLike,
  path: string,
  errors: string[]
): void {
  // Top-level shape: schema.type may be "object" or ["object", "null"].
  if (value === null) {
    const allowsNull =
      schema.type === "null" ||
      (Array.isArray(schema.type) && schema.type.includes("null"));
    if (!allowsNull) errors.push(`${path}: null but schema disallows null`);
    return;
  }

  if (schema.type === "object" || schema.type === undefined) {
    if (!isPlainObject(value)) {
      // schema says object but we got something else
      errors.push(
        `${path}: expected object, got ${Array.isArray(value) ? "array" : typeof value}`
      );
      return;
    }

    // Required keys present?
    for (const reqKey of schema.required ?? []) {
      if (!(reqKey in value)) {
        errors.push(`${path}.${reqKey}: required key missing from return`);
      }
    }

    // No undeclared top-level keys (THE bug class).
    if (schema.properties) {
      const declared = new Set(Object.keys(schema.properties));
      for (const k of Object.keys(value)) {
        if (!declared.has(k)) {
          errors.push(
            `${path}.${k}: return contains key not declared in outputSchema.properties (drift)`
          );
        }
      }
      // Recurse into declared properties whose schema is an object with its
      // own properties — proves the pattern extends to nested validation.
      for (const [k, propSchema] of Object.entries(schema.properties)) {
        if (k in value) {
          const nested = (value as any)[k];
          if (
            propSchema.type === "object" &&
            propSchema.properties &&
            nested !== null &&
            nested !== undefined
          ) {
            assertConforms(nested, propSchema, `${path}.${k}`, errors);
          }
        }
      }
    }
  }
}

function expectConforms(structured: unknown, outputSchema: JSONSchemaLike): void {
  const errors: string[] = [];
  assertConforms(structured, outputSchema, "$", errors);
  expect(errors, errors.join("\n")).toEqual([]);
}

// -----------------------------------------------------------------------
// Per-tool conformance mocks. Each entry mocks the happy-path HTTP for one
// outputSchema-declarer and runs the conformance assertion against the live
// structuredContent. The MOCKED registry is what the meta-test enforces:
// every Tool with outputSchema must have an entry here.
// -----------------------------------------------------------------------

interface ConformanceCase {
  toolName: string;
  arguments: Record<string, unknown>;
  setupMocks: () => void;
}

const CASES: ConformanceCase[] = [
  {
    toolName: "leadbay_account_status",
    arguments: {},
    setupMocks: () => {
      mockHttp([
        {
          method: "GET",
          path: "/1.5/users/me",
          status: 200,
          body: {
            email: "test@example.com",
            name: "Test User",
            admin: true,
            manager: false,
            language: "en",
            organization: {
              id: "org-1",
              name: "Test Co",
              ai_agent_enabled: true,
              computing_intelligence: false,
              quota_plan: "PRO",
            },
            last_requested_lens: 42,
          },
        },
        {
          method: "GET",
          path: "/1.5/organizations/org-1/quota_status",
          status: 200,
          body: { plan: "PRO", windows: [] },
        },
      ]);
    },
  },
  {
    toolName: "leadbay_pull_leads",
    arguments: { count: 10 },
    setupMocks: () => {
      mockHttp([
        {
          method: "GET",
          path: "/1.5/users/me",
          status: 200,
          body: {
            id: "u",
            organization: { id: "org-1", name: "X" },
            last_requested_lens: 42,
          },
        },
        {
          method: "GET",
          path: /\/1\.5\/lenses\/42\/leads\/wishlist/,
          status: 200,
          body: {
            items: [
              {
                id: "lead-1",
                name: "Acme",
                score: 80,
                ai_agent_lead_score: 70,
                location: null,
                description: null,
                size: null,
                website: "acme.com",
                contacts_count: 0,
                org_contacts_count: 0,
                tags: [],
                phone_numbers: [],
                keywords: [],
                recommended_contact_title: null,
                recommended_contact: null,
                liked: false,
                disliked: false,
              },
            ],
            pagination: { page: 0, pages: 1, total: 1 },
            computing_wishlist: false,
            computing_scores: false,
          },
        },
        {
          method: "GET",
          path: "/1.5/leads/lead-1/ai_agent_responses",
          status: 200,
          body: [
            {
              question: "Q1",
              question_created_at: "2026-04-20T00:00:00Z",
              lead_id: "lead-1",
              score: 8,
              response: "good fit",
              computed_at: "2026-04-20T00:00:00Z",
            },
          ],
        },
      ]);
    },
  },
  {
    toolName: "leadbay_research_lead",
    arguments: { leadId: "lead-1", lensId: 42 },
    setupMocks: () => {
      mockHttp([
        // POST /interactions (fire-and-forget) — succeed silently.
        {
          method: "POST",
          path: "/1.5/interactions",
          status: 200,
          body: {},
        },
        // /lenses/42/leads/lead-1
        {
          method: "GET",
          path: /\/1\.5\/lenses\/42\/leads\/lead-1$/,
          status: 200,
          body: {
            id: "lead-1",
            name: "Acme",
            sector_id: 7,
            score: 80,
            ai_agent_lead_score: 70,
            tags: [],
            size: null,
            location: null,
            website: "acme.com",
            description: null,
            short_description: null,
            social: {},
            liked: false,
            disliked: false,
            contacts_count: 0,
            org_contacts_count: 0,
            notes_count: 0,
            epilogue_actions_count: 0,
            prospecting_actions_count: 0,
            recommended_contact_title: null,
            recommended_contact: null,
          },
        },
        {
          method: "GET",
          path: "/1.5/leads/lead-1/ai_agent_responses",
          status: 200,
          body: [
            {
              question: "Why this lead?",
              question_created_at: "2026-04-20T00:00:00Z",
              lead_id: "lead-1",
              score: 8,
              response: "good fit",
              computed_at: "2026-04-20T00:00:00Z",
            },
          ],
        },
        {
          method: "GET",
          path: /\/1\.5\/leads\/lead-1\/enrich\/contacts/,
          status: 200,
          body: [],
        },
        {
          method: "GET",
          path: "/1.5/leads/lead-1/web_fetch",
          status: 200,
          body: { signals: [], status: "complete" },
        },
      ]);
    },
  },
  {
    toolName: "leadbay_bulk_qualify_leads",
    arguments: { leadIds: ["lead-1"] },
    setupMocks: () => {
      mockHttp([
        // ensure_lens / resolve default lens
        {
          method: "GET",
          path: "/1.5/users/me",
          status: 200,
          body: {
            id: "u",
            organization: { id: "org-1", name: "X" },
            last_requested_lens: 42,
          },
        },
        // /lenses/42 — lens load
        {
          method: "GET",
          path: /\/1\.5\/lenses\/42$/,
          status: 200,
          body: { id: 42, name: "L", filter_definition: {}, scoring_definition: {} },
        },
        // POST /lenses/42/leads/qualify_for_review (the launcher)
        {
          method: "POST",
          path: /\/1\.5\/lenses\/42\/leads\/qualify_for_review$/,
          status: 202,
          body: { request_id: "req-1" },
        },
        // First poll — completes immediately.
        {
          method: "GET",
          path: /\/1\.5\/lenses\/42\/leads\/qualify_for_review\/req-1$/,
          status: 200,
          body: {
            status: "completed",
            results: [
              {
                lead_id: "lead-1",
                ai_agent_lead_score: 78,
                qualification: [],
              },
            ],
          },
        },
        // Per-lead ai_agent_responses fetch (some implementations fan out).
        {
          method: "GET",
          path: "/1.5/leads/lead-1/ai_agent_responses",
          status: 200,
          body: [],
        },
      ]);
    },
  },
  {
    toolName: "leadbay_report_outreach",
    arguments: {
      lead_id: "lead-1",
      what: "called the contact",
      verification: { source: "user_confirmed", ref: "user said yes" },
      dry_run: true,
    },
    setupMocks: () => {
      // dry_run path: no HTTP calls expected; the composite returns the
      // dry-run shape directly. This exercises the dry-run branch of the
      // schema — the live branch is exercised by report_outreach.test.ts
      // and is independently asserted by output-schema.test.ts.
      mockHttp([]);
    },
  },
];

// -----------------------------------------------------------------------
// Per-tool conformance assertions.
// -----------------------------------------------------------------------

describe("structuredContent conformance — every outputSchema declarer (iter17)", () => {
  for (const c of CASES) {
    it(`${c.toolName} structuredContent matches outputSchema (no drift)`, async () => {
      c.setupMocks();
      const { mcpClient } = await connect();
      const result = await mcpClient.callTool({
        name: c.toolName,
        arguments: c.arguments,
      });
      expect(
        (result as any).isError,
        `${c.toolName} returned isError — happy-path mock incomplete`
      ).not.toBe(true);

      const structured = (result as any).structuredContent;
      expect(
        structured,
        `${c.toolName} did not emit structuredContent — server.ts only emits for plain-object, non-error returns`
      ).toBeDefined();
      expect(isPlainObject(structured), `${c.toolName} structuredContent is not a plain object`).toBe(true);

      // Pull the tool's own outputSchema from the catalogue (single source
      // of truth) and validate the live shape against it.
      const allTools: Tool[] = [...compositeReadTools, ...compositeWriteTools];
      const tool = allTools.find((t) => t.name === c.toolName);
      expect(tool, `${c.toolName} not found in catalogue`).toBeDefined();
      expect(tool!.outputSchema, `${c.toolName} has no outputSchema`).toBeDefined();

      expectConforms(structured, tool!.outputSchema as JSONSchemaLike);
    });
  }
});

// -----------------------------------------------------------------------
// Drift-catcher meta-test — adding outputSchema to a new tool fails this
// test until a corresponding CASES entry is added.
// -----------------------------------------------------------------------

describe("structuredContent conformance — drift catcher (iter17)", () => {
  it("every Tool with outputSchema has a registered conformance case", () => {
    const allTools: Tool[] = [...compositeReadTools, ...compositeWriteTools];
    const declarers = allTools.filter((t) => t.outputSchema).map((t) => t.name);
    const cases = new Set(CASES.map((c) => c.toolName));
    const missing = declarers.filter((name) => !cases.has(name));
    expect(
      missing,
      `Tools with outputSchema but no conformance case: ${missing.join(", ")}. Add to CASES in output-schema-conformance.test.ts.`
    ).toEqual([]);
  });

  it("assertConforms catches an undeclared top-level key (positive control)", () => {
    const schema: JSONSchemaLike = {
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a"],
    };
    const errors: string[] = [];
    assertConforms({ a: "x", surprise: "drift" }, schema, "$", errors);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/drift/);
  });

  it("assertConforms catches a missing required key (positive control)", () => {
    const schema: JSONSchemaLike = {
      type: "object",
      properties: { a: { type: "string" }, b: { type: "string" } },
      required: ["a", "b"],
    };
    const errors: string[] = [];
    assertConforms({ a: "x" }, schema, "$", errors);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/required key missing/);
  });

  it("assertConforms recurses into nested objects (positive control)", () => {
    const schema: JSONSchemaLike = {
      type: "object",
      properties: {
        nested: {
          type: "object",
          properties: { ok: { type: "string" } },
          required: ["ok"],
        },
      },
    };
    const errors: string[] = [];
    assertConforms({ nested: { ok: "y", bad: "z" } }, schema, "$", errors);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/\$\.nested\.bad/);
  });
});
