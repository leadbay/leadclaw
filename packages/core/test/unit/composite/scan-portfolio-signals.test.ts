/**
 * Unit tests for leadbay_scan_portfolio_signals — the bulk, read-only
 * portfolio signal scan (issue #3704). Verifies: it reads CACHED signals
 * (no web_fetch POST), filters by query + since, separates "no match" from
 * "not researched", folds diacritics/case, caps the fan-out, and survives a
 * 429 mid-scan with partial results.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { scanPortfolioSignals } from "../../../src/composite/scan-portfolio-signals.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.tok", "us");

// A web_fetch payload with the given emoji-section → entries shape.
function webFetch(leadId: string, content: any, inProgress = false) {
  return {
    method: "GET" as const,
    path: `/1.5/leads/${leadId}/web_fetch`,
    status: 200,
    body: { lead_id: leadId, content, fetch_at: "2025-06-01", in_progress: inProgress },
  };
}

beforeEach(() => resetHttpMock());

describe("leadbay_scan_portfolio_signals", () => {
  it("happy path — returns only leads whose signals match the query, with entries quoted", async () => {
    mockHttp([
      webFetch("lead-1", {
        "📈 business signals": [
          { description: "Acme acquired BetaCorp in a $40M deal", source: "techcrunch.com", date: "2025-03-01", hot: true },
          { description: "Hiring 20 engineers", source: "linkedin.com", date: "2025-02-01" },
        ],
      }),
      webFetch("lead-2", {
        "📈 business signals": [
          { description: "Opened a new office in Lyon", source: "lemonde.fr", date: "2025-04-01" },
        ],
      }),
    ]);

    const out: any = await scanPortfolioSignals.execute(newClient(), {
      query: "acquired, M&A",
      leadIds: ["lead-1", "lead-2"],
    });

    expect(out.matched).toHaveLength(1);
    expect(out.matched[0].lead_id).toBe("lead-1");
    expect(out.matched[0].matched_signals).toHaveLength(1);
    expect(out.matched[0].matched_signals[0].description).toContain("acquired BetaCorp");
    expect(out.matched[0].matched_signals[0].hot).toBe(true);
    expect(out.matched_count).toBe(1);
    expect(out.scanned_count).toBe(2);
    expect(out.not_researched).toHaveLength(0);

    // Read-only: NO web_fetch POST was issued.
    const posts = getHttpRequests().filter((r) => r.method === "POST");
    expect(posts).toHaveLength(0);
  });

  it("separates 'not researched' (null/in-progress content) from 'no match'", async () => {
    mockHttp([
      webFetch("lead-1", {
        "📈 business signals": [{ description: "raised a Series B", source: "x.com", date: "2025-05-01" }],
      }),
      webFetch("lead-2", null), // never researched
      webFetch("lead-3", { "📈 business signals": [{ description: "x" }] }, true), // still fetching
    ]);

    const out: any = await scanPortfolioSignals.execute(newClient(), {
      query: "funding, Series",
      leadIds: ["lead-1", "lead-2", "lead-3"],
    });

    expect(out.matched.map((m: any) => m.lead_id)).toEqual(["lead-1"]);
    // lead-2 (null) and lead-3 (in_progress) → not_researched, NOT silently dropped.
    expect(out.not_researched.map((n: any) => n.lead_id).sort()).toEqual(["lead-2", "lead-3"]);
    expect(out.scanned_count).toBe(3);
  });

  it("since filter — entries dated before `since` are excluded; undated entries kept", async () => {
    mockHttp([
      webFetch("lead-1", {
        "📈 business signals": [
          { description: "acquired OldCo", source: "s", date: "2024-08-01" }, // before since
          { description: "acquired NewCo", source: "s", date: "2025-02-01" }, // after since
          { description: "acquired UndatedCo", source: "s" }, // no date → kept
        ],
      }),
    ]);

    const out: any = await scanPortfolioSignals.execute(newClient(), {
      query: "acquired",
      leadIds: ["lead-1"],
      since: "2025-01-01",
    });

    const descs = out.matched[0].matched_signals.map((s: any) => s.description);
    expect(descs).toContain("acquired NewCo");
    expect(descs).toContain("acquired UndatedCo");
    expect(descs).not.toContain("acquired OldCo");
  });

  it("diacritic- and case-insensitive matching — accented query 'racheté' matches plain 'rachete', and 'M&A' matches 'm&a'", async () => {
    mockHttp([
      webFetch("lead-1", {
        // entry has NO accent + different case; query carries the accent + case.
        "📈 signals": [{ description: "L'entreprise a RACHETE un concurrent", source: "lesechos.fr", date: "2025-03-01" }],
      }),
      webFetch("lead-2", {
        "📈 signals": [{ description: "Completed an M&A transaction", source: "ft.com", date: "2025-03-01" }],
      }),
    ]);

    const out: any = await scanPortfolioSignals.execute(newClient(), {
      // "racheté" folds to "rachete" (matches lead-1 regardless of accent/case);
      // "m&a" matches lead-2's "M&A" case-insensitively.
      query: "racheté, m&a",
      leadIds: ["lead-1", "lead-2"],
    });

    expect(out.matched.map((m: any) => m.lead_id).sort()).toEqual(["lead-1", "lead-2"]);
  });

  it("no matches — returns empty matched[], scanned_count correct, no throw", async () => {
    mockHttp([
      webFetch("lead-1", { "📈 signals": [{ description: "nothing relevant", source: "s" }] }),
    ]);

    const out: any = await scanPortfolioSignals.execute(newClient(), {
      query: "acquisition",
      leadIds: ["lead-1"],
    });

    expect(out.matched).toHaveLength(0);
    expect(out.matched_count).toBe(0);
    expect(out.scanned_count).toBe(1);
    expect(out.not_researched).toHaveLength(0);
  });

  it("429 mid-scan — partial matched preserved, quota_exceeded true", async () => {
    mockHttp([
      webFetch("lead-1", {
        "📈 signals": [{ description: "acquired a startup", source: "s", date: "2025-03-01" }],
      }),
      {
        method: "GET",
        path: "/1.5/leads/lead-2/web_fetch",
        status: 429,
        body: { code: "QUOTA_EXCEEDED" },
      },
    ]);

    const out: any = await scanPortfolioSignals.execute(newClient(), {
      query: "acquired",
      leadIds: ["lead-1", "lead-2"],
    });

    expect(out.quota_exceeded).toBe(true);
    expect(out.matched.map((m: any) => m.lead_id)).toEqual(["lead-1"]);
    // lead-2 failed to read → neither matched nor falsely "no match".
    expect(out.matched_count).toBe(1);
  });

  it("max_leads cap — truncated_at is set when leadIds exceed the cap", async () => {
    mockHttp([
      webFetch("lead-1", { "📈 signals": [{ description: "acquired co", source: "s", date: "2025-03-01" }] }),
    ]);

    const out: any = await scanPortfolioSignals.execute(newClient(), {
      query: "acquired",
      leadIds: ["lead-1", "lead-2", "lead-3"],
      max_leads: 1,
    });

    expect(out.truncated_at).toBe(1);
    expect(out.scanned_count).toBe(1);
  });

  it("empty/whitespace query — matches nothing (no false positives)", async () => {
    mockHttp([
      webFetch("lead-1", { "📈 signals": [{ description: "acquired co", source: "s" }] }),
    ]);

    const out: any = await scanPortfolioSignals.execute(newClient(), {
      query: "   ",
      leadIds: ["lead-1"],
    });

    expect(out.matched).toHaveLength(0);
    expect(out.scanned_count).toBe(1);
  });
});
