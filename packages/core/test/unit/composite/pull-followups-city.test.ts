/**
 * pull_followups({city, city_id}) — geo-resolver integration.
 *
 * Verifies the three branches of the city flow:
 *   - city resolves cleanly → set_filter merged with location_ids → 204 stored → /monitor pulled
 *   - city is ambiguous → returns status:"ambiguous_locations" + location_ambiguities, no /monitor call
 *   - city_id (numeric) bypasses the resolver entirely
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
import { pullFollowups } from "../../../src/composite/pull-followups.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

describe("pull_followups city flow", () => {
  it("city resolves unambiguously → merges location_ids into set_filter and pulls", async () => {
    mockHttp([
      {
        method: "GET",
        path: /\/1\.5\/geo\/search\?q=Berlin/,
        status: 200,
        body: {
          results: [
            // Exact name match should win.
            { id: "414522", country: "US", level: 8, name: "Berlin", parent_ids: ["71681", "414522"] },
            { id: "402302", country: "US", level: 8, name: "New Berlin", parent_ids: ["96634", "402302"] },
          ],
          parents: [],
        },
      },
      {
        method: "POST",
        path: "/1.5/monitor/filter",
        status: 204,
        body: "",
      },
      {
        method: "GET",
        path: "/1.5/monitor/filter",
        status: 200,
        body: { criteria: [{ type: "location_ids", is_excluded: false, locations: ["414522"] }] },
      },
      {
        method: "GET",
        path: /\/1\.5\/monitor\?/,
        status: 200,
        body: { items: [{ id: "lead-1", name: "Lead in Berlin" }] },
      },
    ]);

    const result: any = await pullFollowups.execute(newClient(), { city: "Berlin" });
    expect(result.status).toBeUndefined();
    expect(Array.isArray(result.leads)).toBe(true);
    expect(result.leads).toHaveLength(1);

    const reqs = getHttpRequests();
    const filterPost = reqs.find((r) => r.method === "POST" && r.path === "/1.5/monitor/filter");
    expect(filterPost).toBeDefined();
    const body = JSON.parse(filterPost!.body!);
    expect(body.criteria[0]).toEqual({
      type: "location_ids",
      is_excluded: false,
      locations: ["414522"],
    });
  });

  it("ambiguous city → returns status:'ambiguous_locations' and does NOT call /monitor", async () => {
    mockHttp([
      {
        method: "GET",
        // Wide regex — match any q= value, so we don't miss due to URL encoding.
        path: /\/1\.5\/geo\/search/,
        status: 200,
        body: {
          // Multiple comparable matches — no clear winner.
          results: [
            { id: "1810724", country: "US", level: 8, name: "Park", parent_ids: [] },
            { id: "360120", country: "US", level: 8, name: "Parker", parent_ids: [] },
            { id: "467362", country: "US", level: 8, name: "Parma", parent_ids: [] },
          ],
          parents: [],
        },
      },
    ]);

    const result: any = await pullFollowups.execute(newClient(), { city: "Pa" });
    const reqs = getHttpRequests();
    expect(result.status).toBe("ambiguous_locations");
    expect(Array.isArray(result.location_ambiguities)).toBe(true);
    expect(result.location_ambiguities[0].matches.length).toBeGreaterThan(0);

    // /monitor must NOT have been called — agent picks an id first.
    const monitorCall = reqs.find((r) => r.path.startsWith("/1.5/monitor?"));
    expect(monitorCall).toBeUndefined();
  });

  it("city_id (numeric) bypasses the resolver and merges directly", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.5/monitor/filter",
        status: 204,
        body: "",
      },
      {
        method: "GET",
        path: "/1.5/monitor/filter",
        status: 200,
        body: { criteria: [{ type: "location_ids", is_excluded: false, locations: ["414522"] }] },
      },
      {
        method: "GET",
        path: /\/1\.5\/monitor\?/,
        status: 200,
        body: { items: [] },
      },
    ]);

    await pullFollowups.execute(newClient(), { city_id: "414522" });

    const reqs = getHttpRequests();
    // No /geo/search call.
    expect(reqs.find((r) => r.path.startsWith("/1.5/geo/search"))).toBeUndefined();
    const filterPost = reqs.find((r) => r.method === "POST" && r.path === "/1.5/monitor/filter");
    const body = JSON.parse(filterPost!.body!);
    expect(body.criteria[0].locations).toEqual(["414522"]);
  });

  it("city + existing set_filter → merges location_ids alongside other criteria", async () => {
    mockHttp([
      {
        method: "GET",
        path: /\/1\.5\/geo\/search\?q=Paris/,
        status: 200,
        body: {
          results: [{ id: "416102", country: "US", level: 8, name: "Paris", parent_ids: [] }],
          parents: [],
        },
      },
      { method: "POST", path: "/1.5/monitor/filter", status: 204, body: "" },
      { method: "GET", path: "/1.5/monitor/filter", status: 200, body: { criteria: [] } },
      { method: "GET", path: /\/1\.5\/monitor\?/, status: 200, body: { items: [] } },
    ]);

    await pullFollowups.execute(newClient(), {
      city: "Paris",
      set_filter: {
        criteria: [{ type: "size", is_excluded: false, sizes: [{ min: 50, max: 200 }] }],
      },
    });

    const reqs = getHttpRequests();
    const filterPost = reqs.find((r) => r.method === "POST" && r.path === "/1.5/monitor/filter");
    const body = JSON.parse(filterPost!.body!);
    const types = body.criteria.map((c: any) => c.type);
    expect(types).toContain("size");
    expect(types).toContain("location_ids");
  });
});
