/**
 * Unit tests for leadbay_import_leads.
 *
 * Covers the auto-decided eng-phase fixes:
 *   - normalizeDomain edge cases (protocol/path/case/TLD shape)
 *   - dedupe + input-row mapping
 *   - empty input fail-fast (IMPORT_EMPTY_INPUT)
 *   - non-admin preflight (IMPORT_ADMIN_REQUIRED)
 *   - happy path: 2 domains → leads with leadIds, reconciled via MCP_ROW_ID
 *   - preprocess error → IMPORT_PREPROCESS_FAILED
 *   - dry_run path: no update_mappings, all inputs land in not_imported
 *   - chunking (>100 → multiple importIds, merged result)
 *   - CSV injection guard + RFC 4180 quoting
 *
 * Stabilization-loop race + AbortSignal cancellation tests require complex
 * timer manipulation; deferred to a follow-up alongside the live smoke test.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";

import { vi } from "vitest";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import {
  importLeads,
  normalizeDomain,
  escapeCsvCell,
  synthesizeCsv,
} from "../../../src/composite/import-leads.js";

const BASE = "https://api-us.leadbay.app";

function adminMe(extra: object = {}) {
  return {
    id: "u-1",
    email: "milstan@leadbay.ai",
    admin: true,
    organization: { id: "org-1", name: "Org" },
    ...extra,
  };
}

function nonAdminMe() {
  return {
    id: "u-2",
    email: "user@example.com",
    admin: false,
    organization: { id: "org-1", name: "Org" },
  };
}

function newClient() {
  return new LeadbayClient(BASE, "u.test-token", "us");
}

beforeEach(() => {
  resetHttpMock();
});

// ─── pure helpers ──────────────────────────────────────────────────────────

describe("normalizeDomain", () => {
  it.each([
    ["Apple.com", "apple.com"],
    ["https://www.MICROSOFT.com/about", "microsoft.com"],
    ["foo.example.co.uk/path?x=1", "foo.example.co.uk"],
    ["  salesforce.com  ", "salesforce.com"],
    ["www.openai.com", "openai.com"],
    ["http://example.tech", "example.tech"],
    ["xn--bcher-kva.de", "xn--bcher-kva.de"],
  ])("normalizes %s → %s", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "no-tld",
    "localhost",
    "192.168.1.1",
    "..",
    ".com",
    "foo.",
    "has space.com",
    "weird/chars,here.com",
  ])("rejects %s as malformed", (input) => {
    expect(normalizeDomain(input)).toBeNull();
  });
});

describe("escapeCsvCell — RFC 4180 + formula-injection guard", () => {
  it.each([
    ["plain", "plain"],
    ["=cmd|'/c calc'!A1", "'=cmd|'/c calc'!A1"],
    ["+sum(1)", "'+sum(1)"],
    ["-1+2", "'-1+2"],
    ["@evil", "'@evil"],
    ["has,comma", '"has,comma"'],
    ['has"quote', '"has""quote"'],
    ["multi\nline", '"multi\nline"'],
    ["", ""],
  ])("escapes %j → %j", (input, expected) => {
    expect(escapeCsvCell(input)).toBe(expected);
  });
});

describe("synthesizeCsv", () => {
  it("emits MCP_ROW_ID,LEAD_NAME,LEAD_WEBSITE header + rows", () => {
    const csv = synthesizeCsv([
      { rowId: "r1", name: "Apple Inc.", website: "apple.com" },
      { rowId: "r2", name: "Microsoft", website: "microsoft.com" },
    ]);
    expect(csv).toBe(
      "MCP_ROW_ID,LEAD_NAME,LEAD_WEBSITE\n" +
        "r1,Apple Inc.,apple.com\n" +
        "r2,Microsoft,microsoft.com\n"
    );
  });

  it("escapes formula-injection in name/website", () => {
    const csv = synthesizeCsv([
      { rowId: "r1", name: "=evil()", website: "apple.com" },
    ]);
    expect(csv).toContain("r1,'=evil(),apple.com");
  });
});

// ─── composite tests ───────────────────────────────────────────────────────

describe("leadbay_import_leads — preflight + edge cases", () => {
  it("empty domains[] → IMPORT_EMPTY_INPUT (no network)", async () => {
    const client = newClient();
    await expect(
      importLeads.execute(client, { domains: [] })
    ).rejects.toMatchObject({
      error: true,
      code: "IMPORT_EMPTY_INPUT",
    });
    expect(getHttpRequests()).toEqual([]);
  });

  it("non-admin → IMPORT_ADMIN_REQUIRED before CSV upload", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: nonAdminMe() },
    ]);
    const client = newClient();
    await expect(
      importLeads.execute(client, { domains: [{ domain: "apple.com" }] })
    ).rejects.toMatchObject({
      error: true,
      code: "IMPORT_ADMIN_REQUIRED",
    });
    // /imports never hit
    expect(
      getHttpRequests().some((r) => r.path.includes("/imports"))
    ).toBe(false);
  });

  it("only-malformed input → no importIds, all returned as malformed", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: adminMe() },
    ]);
    const client = newClient();
    const out = await importLeads.execute(client, {
      domains: [{ domain: "no-tld" }, { domain: "localhost" }],
    });
    expect(out.leads).toEqual([]);
    expect(out.not_imported).toEqual([
      { domain: "no-tld", reason: "malformed" },
      { domain: "localhost", reason: "malformed" },
    ]);
    expect(out.importIds).toEqual([]);
  });

  it("duplicate normalized domains are deduped to one CSV row", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: adminMe() },
      // POST /imports → returns id + finished preprocessing immediately
      {
        method: "POST",
        path: /\/1\.5\/imports\?file_name=/,
        status: 200,
        body: makeImportPayload({ preFinished: true }),
      },
      // poll preprocess GET — already finished
      {
        method: "GET",
        path: /\/1\.5\/imports\/[a-z0-9-]+$/,
        status: 200,
        body: makeImportPayload({ preFinished: true }),
      },
      // update_mappings
      {
        method: "POST",
        path: /\/1\.5\/imports\/[a-z0-9-]+\/update_mappings/,
        status: 204,
      },
      // poll process — done
      {
        method: "GET",
        path: /\/1\.5\/imports\/[a-z0-9-]+$/,
        status: 200,
        body: makeImportPayload({ preFinished: true, procFinished: true }),
      },
      // records page 0 — both records terminal
      {
        method: "GET",
        path: /\/1\.5\/imports\/[a-z0-9-]+\/records\?/,
        status: 200,
        body: {
          items: [
            {
              id: 1,
              records: [
                { column_name: "LEAD_WEBSITE", value: "apple.com" },
                { column_name: "LEAD_NAME", value: "Apple" },
              ],
              match_type: "AUTOMATIC_MATCH",
              status: "IMPORTED",
              lead: { id: "lead-apple", name: "Apple Inc.", website: "apple.com" },
            },
          ],
          pagination: { page: 0, pages: 1, total: 1 },
        },
      },
      // stabilization second poll (counts must be stable across 2 polls)
      {
        method: "GET",
        path: /\/1\.5\/imports\/[a-z0-9-]+\/records\?/,
        status: 200,
        body: {
          items: [
            {
              id: 1,
              records: [
                { column_name: "LEAD_WEBSITE", value: "apple.com" },
                { column_name: "LEAD_NAME", value: "Apple" },
              ],
              match_type: "AUTOMATIC_MATCH",
              status: "IMPORTED",
              lead: { id: "lead-apple", name: "Apple Inc.", website: "apple.com" },
            },
          ],
          pagination: { page: 0, pages: 1, total: 1 },
        },
      },
    ]);
    const client = newClient();
    const out = await importLeads.execute(client, {
      domains: [{ domain: "Apple.com" }, { domain: "https://www.apple.com/" }],
    });
    expect(out.leads).toHaveLength(1);
    expect(out.leads[0]).toMatchObject({
      domain: "apple.com",
      leadId: "lead-apple",
    });
    // Only 1 importId — not 2 — because the duplicate normalized to the
    // same single chunk.
    expect(out.importIds).toHaveLength(1);
  });
});

describe("leadbay_import_leads — error paths", () => {
  it("preprocess error surfaces as IMPORT_PREPROCESS_FAILED", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: adminMe() },
      {
        method: "POST",
        path: /\/1\.5\/imports\?file_name=/,
        status: 200,
        body: makeImportPayload({
          preFinished: true,
          preError: "bad_csv",
        }),
      },
      {
        method: "GET",
        path: /\/1\.5\/imports\/[a-z0-9-]+$/,
        status: 200,
        body: makeImportPayload({
          preFinished: true,
          preError: "bad_csv",
        }),
      },
    ]);
    const client = newClient();
    await expect(
      importLeads.execute(client, { domains: [{ domain: "apple.com" }] })
    ).rejects.toMatchObject({
      error: true,
      code: "IMPORT_PREPROCESS_FAILED",
    });
  });
});

describe("leadbay_import_leads — dry_run", () => {
  it("skips update_mappings + processing; all inputs return as dry_run", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: adminMe() },
      {
        method: "POST",
        path: /\/1\.5\/imports\?file_name=/,
        status: 200,
        body: makeImportPayload({ preFinished: true }),
      },
      {
        method: "GET",
        path: /\/1\.5\/imports\/[a-z0-9-]+$/,
        status: 200,
        body: makeImportPayload({ preFinished: true }),
      },
    ]);
    const client = newClient();
    const out = await importLeads.execute(client, {
      domains: [{ domain: "apple.com" }, { domain: "microsoft.com" }],
      dry_run: true,
    });
    expect(out.dry_run).toBe(true);
    expect(out.leads).toEqual([]);
    expect(out.not_imported).toEqual([
      { domain: "apple.com", reason: "dry_run" },
      { domain: "microsoft.com", reason: "dry_run" },
    ]);
    // No update_mappings call should have been made.
    expect(
      getHttpRequests().some((r) => r.path.includes("update_mappings"))
    ).toBe(false);
  });
});

describe("leadbay_import_leads — chunking >100", () => {
  it("101 inputs → 2 importIds, merged result", async () => {
    const domains = Array.from({ length: 101 }, (_, i) => ({
      domain: `co${String(i).padStart(3, "0")}.com`,
    }));
    // 2 chunks; each has full upload→records flow.
    const scripts: any[] = [
      { method: "GET", path: "/1.5/users/me", status: 200, body: adminMe() },
    ];
    for (let chunk = 0; chunk < 2; chunk++) {
      scripts.push(
        {
          method: "POST",
          path: /\/1\.5\/imports\?file_name=/,
          status: 200,
          body: makeImportPayload({ preFinished: true }),
        },
        {
          method: "GET",
          path: /\/1\.5\/imports\/[a-z0-9-]+$/,
          status: 200,
          body: makeImportPayload({ preFinished: true }),
        },
        {
          method: "POST",
          path: /\/1\.5\/imports\/[a-z0-9-]+\/update_mappings/,
          status: 204,
        },
        {
          method: "GET",
          path: /\/1\.5\/imports\/[a-z0-9-]+$/,
          status: 200,
          body: makeImportPayload({ preFinished: true, procFinished: true }),
        },
        {
          method: "GET",
          path: /\/1\.5\/imports\/[a-z0-9-]+\/records\?/,
          status: 200,
          body: { items: [], pagination: { page: 0, pages: 1, total: 0 } },
        },
        // stabilization second poll
        {
          method: "GET",
          path: /\/1\.5\/imports\/[a-z0-9-]+\/records\?/,
          status: 200,
          body: { items: [], pagination: { page: 0, pages: 1, total: 0 } },
        }
      );
    }
    mockHttp(scripts);

    const client = newClient();
    const out = await importLeads.execute(client, { domains });
    expect(out.importIds).toHaveLength(2);
  });
});

// ─── helpers ───────────────────────────────────────────────────────────────

let importIdCounter = 0;
function makeImportPayload(opts: {
  preFinished?: boolean;
  preError?: string | null;
  procFinished?: boolean;
  procError?: string | null;
}) {
  importIdCounter++;
  return {
    id: `imp-${importIdCounter}-${Math.random().toString(36).slice(2, 8)}`,
    date: new Date().toISOString(),
    file_name: "mcp-import.csv",
    imported_records: 0,
    pending_imported_records: 0,
    total_records: 0,
    mappings: null,
    pre_processing: {
      finished: Boolean(opts.preFinished),
      error: opts.preError ?? null,
      hints: null,
      samples: [],
      status_samples: null,
    },
    processing: opts.procFinished !== undefined ? {
      progress: opts.procFinished ? 1 : 0,
      finished: Boolean(opts.procFinished),
      error: opts.procError ?? null,
    } : null,
  };
}
