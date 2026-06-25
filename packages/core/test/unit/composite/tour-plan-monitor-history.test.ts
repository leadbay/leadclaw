import { beforeEach, describe, expect, it, vi } from "vitest";
import { httpsMockFactory, mockHttp, resetHttpMock } from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { tourPlan } from "../../../src/composite/tour-plan.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

/**
 * Regression for the PR-review catch (#3779): the Customer/Qualified split
 * must key off the history fields that actually exist on the pull_followups
 * payload — `epilogue_status`, `last_prospecting_action_at`,
 * `last_monitor_action_at` — NOT a bare `last_monitor_action` (which is not a
 * real field, so every monitor lead would have been mislabeled ★ Qualified).
 */
function monitorLead(over: Record<string, unknown>) {
  return {
    id: "m",
    name: "Mono Co",
    location: { pos: [48.85, 2.35], full: "Paris, FR", city: "Paris" },
    recommended_contact: { first_name: "A", last_name: "B", job_title: "Dir", email: "a@b.co" },
    split_ai_summary: { next_step: "Worth a stop" },
    ...over,
  };
}

function mockFanOut(monitorItems: unknown[]) {
  mockHttp([
    {
      method: "GET",
      path: /\/1\.5\/geo\/search/,
      status: 200,
      body: { results: [{ id: "100", country: "FR", level: 8, name: "Paris", parent_ids: [] }], parents: [] },
    },
    { method: "POST", path: "/1.5/monitor/filter", status: 204, body: "" },
    {
      method: "GET",
      path: "/1.5/monitor/filter",
      status: 200,
      body: { criteria: [{ type: "location_ids", is_excluded: false, locations: ["100"] }] },
    },
    { method: "GET", path: /\/1\.5\/monitor\?/, status: 200, body: { items: monitorItems } },
    { method: "GET", path: "/1.5/users/me", status: 200, body: { last_requested_lens: 5 } },
    { method: "GET", path: "/1.5/users/me", status: 200, body: { last_requested_lens: 5 } },
    {
      method: "GET",
      path: /\/1\.5\/lenses\/5\/leads\/wishlist/,
      status: 200,
      body: { items: [], computing_wishlist: false, computing_scoring: false },
    },
  ]);
}

async function badgeFor(over: Record<string, unknown>): Promise<string> {
  mockFanOut([monitorLead(over)]);
  const result: any = await tourPlan.execute(newClient(), { city: "Paris" });
  return result.map_locations[0].notes.split(" —")[0];
}

describe("leadbay_tour_plan — Customer/Qualified keyed off real history fields (#3779)", () => {
  it("epilogue_status present → ★ Customer", async () => {
    expect(await badgeFor({ epilogue_status: "EPILOGUE_INTEREST_VALIDATED_OR_MEETING_PLANED" })).toBe("★ Customer");
  });

  it("last_prospecting_action_at present → ★ Customer", async () => {
    expect(await badgeFor({ last_prospecting_action_at: "2026-06-01T00:00:00Z" })).toBe("★ Customer");
  });

  it("last_monitor_action_at present → ★ Customer", async () => {
    expect(await badgeFor({ last_monitor_action_at: "2026-05-15T00:00:00Z" })).toBe("★ Customer");
  });

  it("no history fields → ★ Qualified", async () => {
    expect(await badgeFor({})).toBe("★ Qualified");
  });

  it("the non-existent `last_monitor_action` field does NOT make a lead a Customer", async () => {
    // Guards the original bug: this field is not part of the payload contract,
    // so it must be ignored — the lead has no real history → Qualified.
    expect(await badgeFor({ last_monitor_action: "CONTACTED" })).toBe("★ Qualified");
  });
});
