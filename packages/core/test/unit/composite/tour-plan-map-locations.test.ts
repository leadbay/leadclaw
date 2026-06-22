import { beforeEach, describe, expect, it, vi } from "vitest";
import { httpsMockFactory, mockHttp, resetHttpMock } from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { tourPlan } from "../../../src/composite/tour-plan.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

/**
 * tour_plan fans out to pullFollowups (city → geo/search → monitor) and
 * pullLeads (lens → wishlist). These helpers mock that fan-out so the test
 * only has to vary the lead fixtures it cares about.
 */
function monitorLead(over: Record<string, unknown>) {
  return {
    id: "m-x",
    name: "Monitor Co",
    location: { pos: [48.85, 2.35], full: "1 Rue X, Paris, France", city: "Paris" },
    recommended_contact: {
      first_name: "Marie",
      last_name: "Dupont",
      job_title: "Sales Director",
      phone_number: "+33 1 23 45 67 89",
      email: "marie@example.fr",
    },
    split_ai_summary: { next_step: "Strong distributor fit" },
    ...over,
  };
}

function discoverLead(over: Record<string, unknown>) {
  return {
    id: "d-x",
    name: "Discover Co",
    // City must match the tour_plan `city` arg ("Paris") or the composite's
    // client-side geo filter drops it before it can reach the map.
    location: { pos: [48.86, 2.34], full: "2 Rue Y, Paris, France", city: "Paris" },
    recommended_contact: {
      first_name: "Paul",
      last_name: "Martin",
      job_title: "CEO",
      email: "paul@example.fr",
    },
    split_ai_summary: { next_step: "Fresh prospect" },
    ...over,
  };
}

function mockFanOut(monitorItems: unknown[], wishlistItems: unknown[]) {
  mockHttp([
    // pullFollowups city flow (city = "Paris")
    {
      method: "GET",
      path: /\/1\.5\/geo\/search/,
      status: 200,
      body: {
        results: [
          { id: "100", country: "FR", level: 8, name: "Paris", parent_ids: [] },
        ],
        parents: [],
      },
    },
    { method: "POST", path: "/1.5/monitor/filter", status: 204, body: "" },
    {
      method: "GET",
      path: "/1.5/monitor/filter",
      status: 200,
      body: { criteria: [{ type: "location_ids", is_excluded: false, locations: ["100"] }] },
    },
    {
      method: "GET",
      path: /\/1\.5\/monitor\?/,
      status: 200,
      body: { items: monitorItems },
    },
    // pullLeads flow — lens resolution via /users/me, then wishlist.
    // resolveMe()/resolveDefaultLens() are called by both pullFollowups and
    // pullLeads; the client caches after the first hit, but supply two scripts
    // so the parallel fan-out never races on a consumed mock.
    {
      method: "GET",
      path: "/1.5/users/me",
      status: 200,
      body: { last_requested_lens: 5 },
    },
    {
      method: "GET",
      path: "/1.5/users/me",
      status: 200,
      body: { last_requested_lens: 5 },
    },
    {
      method: "GET",
      path: /\/1\.5\/lenses\/5\/leads\/wishlist/,
      status: 200,
      body: { items: wishlistItems, computing_wishlist: false, computing_scoring: false },
    },
  ]);
}

describe("leadbay_tour_plan — map_locations shaping (#3779)", () => {
  it("assigns ★ Customer / ★ Qualified / ✦ New badges and correct coordinates", async () => {
    const customer = monitorLead({ id: "m-cust", name: "Acme Customer", last_monitor_action: "CONTACTED" });
    const qualified = monitorLead({ id: "m-qual", name: "Beta Qualified" }); // no last_monitor_action
    const fresh = discoverLead({ id: "d-new", name: "Gamma New" });

    mockFanOut([customer, qualified], [fresh]);

    const result: any = await tourPlan.execute(newClient(), { city: "Paris" });

    expect(result.map_locations).toHaveLength(3);
    const byName = Object.fromEntries(result.map_locations.map((m: any) => [m.name, m]));

    expect(byName["Acme Customer"].notes.startsWith("★ Customer —")).toBe(true);
    expect(byName["Beta Qualified"].notes.startsWith("★ Qualified —")).toBe(true);
    expect(byName["Gamma New"].notes.startsWith("✦ New —")).toBe(true);

    // Coordinates + address carried verbatim from location.
    expect(byName["Acme Customer"].latitude).toBe(48.85);
    expect(byName["Acme Customer"].longitude).toBe(2.35);
    expect(byName["Acme Customer"].address).toBe("1 Rue X, Paris, France");
    // Contact ask folded into notes.
    expect(byName["Acme Customer"].notes).toContain("Marie Dupont");
    expect(byName["Acme Customer"].notes).toContain("+33 1 23 45 67 89");

    expect(result.map_summary).toEqual({
      total_leads: 3,
      leads_with_coords: 3,
      leads_without_coords: 0,
    });
  });

  it("omits leads without valid coordinates and counts them in map_summary", async () => {
    const withCoords = monitorLead({ id: "m-ok", name: "Has Coords", last_monitor_action: "MEETING_BOOKED" });
    const nullPos = monitorLead({ id: "m-null", name: "No Coords", location: { pos: null, full: "Somewhere" } });
    const malformed = discoverLead({ id: "d-bad", name: "Bad Coords", location: { pos: [48.85], full: "Half, Paris", city: "Paris" } });

    mockFanOut([withCoords, nullPos], [malformed]);

    const result: any = await tourPlan.execute(newClient(), { city: "Paris" });

    expect(result.map_locations).toHaveLength(1);
    expect(result.map_locations[0].name).toBe("Has Coords");
    expect(result.map_summary).toEqual({
      total_leads: 3,
      leads_with_coords: 1,
      leads_without_coords: 2,
    });
  });

  it("a discover lead carrying a stray last_monitor_action is still ✦ New", async () => {
    const sneaky = discoverLead({ id: "d-sneaky", name: "Sneaky New", last_monitor_action: "CONTACTED" });

    mockFanOut([], [sneaky]);

    const result: any = await tourPlan.execute(newClient(), { city: "Paris" });

    expect(result.map_locations).toHaveLength(1);
    expect(result.map_locations[0].notes.startsWith("✦ New —")).toBe(true);
  });

  it("ambiguous city returns a stable empty map shape", async () => {
    mockHttp([
      {
        method: "GET",
        path: /\/1\.5\/geo\/search/,
        status: 200,
        body: {
          results: [
            { id: "1", country: "US", level: 8, name: "Park", parent_ids: [] },
            { id: "2", country: "US", level: 8, name: "Parker", parent_ids: [] },
            { id: "3", country: "US", level: 8, name: "Parma", parent_ids: [] },
          ],
          parents: [],
        },
      },
      // pullLeads still runs in parallel; mock its flow so allSettled resolves.
      { method: "GET", path: "/1.5/users/me", status: 200, body: { last_requested_lens: 5 } },
      { method: "GET", path: "/1.5/users/me", status: 200, body: { last_requested_lens: 5 } },
      {
        method: "GET",
        path: /\/1\.5\/lenses\/5\/leads\/wishlist/,
        status: 200,
        body: { items: [], computing_wishlist: false, computing_scoring: false },
      },
    ]);

    const result: any = await tourPlan.execute(newClient(), { city: "Pa" });

    expect(result.status).toBe("ambiguous_locations");
    expect(result.map_locations).toEqual([]);
    expect(result.map_summary).toEqual({
      total_leads: 0,
      leads_with_coords: 0,
      leads_without_coords: 0,
    });
  });
});
