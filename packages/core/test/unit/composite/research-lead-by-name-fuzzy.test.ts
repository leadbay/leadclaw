/**
 * leadbay_research_lead_by_name_fuzzy — fuzzy resolution + delegation.
 *
 * Verifies:
 *   - happy path: single fuzzy match → delegates to _by_id, populates
 *     _meta.resolved_from / resolved_query.
 *   - multiple matches → primary is highest-score, rest land in
 *     _meta.match_candidates (up to 4).
 *   - zero matches → LEAD_NOT_FOUND with nearest_names hint in message.
 *
 * The ranking helper is unit-tested directly to pin the substring +
 * descending-score behavior.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import {
  researchLeadByNameFuzzy,
  rankSubstringMatches,
} from "../../../src/composite/research-lead-by-name-fuzzy.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

// Stub the lens-scoped + sub-resource fetches the _by_id composite needs
// after the fuzzy resolution lands on a leadId. The wrapper itself only
// owns the wishlist call + the delegate; everything else is _by_id's
// network surface.
function mockByIdSubResources(leadId: string) {
  return [
    // /interactions fire-and-forget
    { method: "POST" as const, path: "/1.5/interactions", status: 200, body: {} },
    // lens-scoped lead profile
    {
      method: "GET" as const,
      path: new RegExp(`/1\\.5/lenses/42/leads/${leadId}$`),
      status: 200,
      body: {
        id: leadId,
        name: "Acme",
        score: 80,
        ai_agent_lead_score: 70,
        location: null,
        description: null,
        size: null,
        website: "acme.com",
        tags: [],
        keywords: [],
        notes_count: 0,
        epilogue_actions_count: 0,
        prospecting_actions_count: 0,
        org_contacts_count: 0,
        liked: false,
        disliked: false,
        new: false,
        recommended_contact: null,
      },
    },
    // qualification (additive)
    { method: "GET" as const, path: `/1.5/leads/${leadId}/ai_agent_responses`, status: 200, body: [] },
    // enrich/contacts (additive)
    { method: "GET" as const, path: new RegExp(`/1\\.5/leads/${leadId}/enrich/contacts`), status: 200, body: [] },
    // web_fetch (additive)
    { method: "GET" as const, path: `/1.5/leads/${leadId}/web_fetch`, status: 200, body: { content: null, fetch_at: null } },
    // activities (additive)
    { method: "GET" as const, path: new RegExp(`/1\\.5/leads/${leadId}/activities`), status: 200, body: { items: [], pagination: { page: 0, pages: 1, total: 0 } } },
    // org contacts (only fetched conditionally — when org_contacts_count > 0
    // it would be triggered; mock anyway in case the composite changes)
    { method: "GET" as const, path: new RegExp(`/1\\.5/leads/${leadId}/contacts`), status: 200, body: [] },
  ];
}

describe("research_lead_by_name_fuzzy", () => {
  it("ranks substring matches by descending score", () => {
    const ranked = rankSubstringMatches("acme", [
      { id: "1", name: "Acme Corp", score: 50 },
      { id: "2", name: "Acme Health", score: 90 },
      { id: "3", name: "Globex", score: 100 },
      { id: "4", name: "Old Acme", score: null },
    ]);
    expect(ranked.map((m) => m.id)).toEqual(["2", "1", "4"]);
  });

  it("happy path — single fuzzy match delegates to _by_id with resolved_from", async () => {
    mockHttp([
      // resolveDefaultLens
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
      // wishlist for fuzzy resolution
      {
        method: "GET",
        path: /\/1\.5\/lenses\/42\/leads\/wishlist/,
        status: 200,
        body: {
          items: [{ id: "lead-1", name: "Acme Corp", score: 80 }],
          pagination: { page: 0, pages: 1, total: 1 },
        },
      },
      ...mockByIdSubResources("lead-1"),
    ]);

    const res: any = await researchLeadByNameFuzzy.execute(
      newClient(),
      { companyName: "acme" }
    );
    expect(res._meta.resolved_from).toBe("companyName");
    expect(res._meta.resolved_query).toBe("acme");
    expect(res._meta.match_candidates).toEqual([]);
    expect(res.firmographics.id).toBe("lead-1");
  });

  it("multiple matches — primary is highest-score; rest populate match_candidates (≤4)", async () => {
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
            { id: "lead-a", name: "Acme Health", score: 50 },
            { id: "lead-b", name: "Acme Corp", score: 90 },
            { id: "lead-c", name: "Old Acme", score: 70 },
            { id: "lead-d", name: "Acme Labs", score: 60 },
            { id: "lead-e", name: "Acme Robotics", score: 55 },
            { id: "lead-f", name: "Acme Studios", score: 40 },
            { id: "lead-g", name: "Globex", score: 100 },
          ],
          pagination: { page: 0, pages: 1, total: 7 },
        },
      },
      ...mockByIdSubResources("lead-b"),
    ]);

    const res: any = await researchLeadByNameFuzzy.execute(
      newClient(),
      { companyName: "acme" }
    );
    expect(res.firmographics.id).toBe("lead-b");
    expect(res._meta.match_candidates).toHaveLength(4);
    // candidates ordered by descending score, primary excluded
    expect(res._meta.match_candidates.map((m: any) => m.leadId)).toEqual([
      "lead-c", "lead-d", "lead-e", "lead-a",
    ]);
  });

  it("zero matches — throws LEAD_NOT_FOUND with nearest names in the hint", async () => {
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
            { id: "lead-x", name: "Initech", score: 90 },
            { id: "lead-y", name: "Globex", score: 80 },
          ],
          pagination: { page: 0, pages: 1, total: 2 },
        },
      },
    ]);

    await expect(
      researchLeadByNameFuzzy.execute(newClient(), { companyName: "Acme" })
    ).rejects.toMatchObject({
      code: "LEAD_NOT_FOUND",
    });
  });
});
