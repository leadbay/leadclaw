import { describe, it, expect, beforeEach } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
} from "../../harness.js";

import { vi } from "vitest";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { resolveLocations } from "../../../src/composite/_geo-helpers.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

describe("resolveLocations", () => {
  it("forwards numeric-id texts as-is without hitting /geo/search", async () => {
    mockHttp([]);
    const out = await resolveLocations(newClient(), ["414522", "9999"]);
    expect(out.resolved).toEqual(["414522", "9999"]);
    expect(out.ambiguities).toHaveLength(0);
  });

  it("exact-name match wins even when multiple results returned", async () => {
    mockHttp([
      {
        method: "GET",
        path: /\/geo\/search\?q=Berlin/,
        status: 200,
        body: {
          results: [
            { id: "1", country: "US", level: 8, name: "New Berlin", parent_ids: [] },
            { id: "2", country: "US", level: 8, name: "Berlin", parent_ids: [] },
            { id: "3", country: "US", level: 8, name: "East Berlin", parent_ids: [] },
          ],
          parents: [],
        },
      },
    ]);
    const out = await resolveLocations(newClient(), ["Berlin"]);
    expect(out.resolved).toEqual(["2"]);
    expect(out.ambiguities).toHaveLength(0);
  });

  it("single result resolves cleanly", async () => {
    mockHttp([
      {
        method: "GET",
        path: /\/geo\/search\?q=Parlier/,
        status: 200,
        body: {
          results: [{ id: "130508", country: "US", level: 8, name: "Parlier", parent_ids: [] }],
          parents: [],
        },
      },
    ]);
    const out = await resolveLocations(newClient(), ["Parlier"]);
    expect(out.resolved).toEqual(["130508"]);
  });

  it("ambiguous result returns the top candidates without picking", async () => {
    mockHttp([
      {
        method: "GET",
        path: /\/geo\/search\?q=Pa/,
        status: 200,
        body: {
          results: [
            { id: "1", country: "US", level: 8, name: "Park", parent_ids: [] },
            { id: "2", country: "US", level: 8, name: "Paris", parent_ids: [] },
            { id: "3", country: "US", level: 8, name: "Parma", parent_ids: [] },
            { id: "4", country: "US", level: 8, name: "Parkin", parent_ids: [] },
          ],
          parents: [],
        },
      },
    ]);
    const out = await resolveLocations(newClient(), ["Pa"]);
    expect(out.resolved).toHaveLength(0);
    expect(out.ambiguities).toHaveLength(1);
    expect(out.ambiguities[0].location_text).toBe("Pa");
    expect(out.ambiguities[0].matches.length).toBeGreaterThan(0);
  });

  it("empty results surfaces an empty ambiguity (no match)", async () => {
    mockHttp([
      {
        method: "GET",
        path: /\/geo\/search\?q=zzzzz/,
        status: 200,
        body: { results: [], parents: [] },
      },
    ]);
    const out = await resolveLocations(newClient(), ["zzzzz"]);
    expect(out.resolved).toHaveLength(0);
    expect(out.ambiguities).toHaveLength(1);
    expect(out.ambiguities[0].matches).toHaveLength(0);
  });

  it("expands NYC alias to the canonical backend name (exact name match wins)", async () => {
    // NYC alias maps to "City of New York" — the exact level-5 backend
    // name — so the result hits score 1.0 and resolves without ambiguity.
    mockHttp([
      {
        method: "GET",
        // The composite must hit /geo/search with the expanded query, not raw NYC.
        path: /\/geo\/search\?q=City%20of%20New%20York/,
        status: 200,
        body: {
          results: [
            { id: "16860", country: "US", level: 5, name: "City of New York", parent_ids: [] },
            { id: "1213", country: "US", level: 4, name: "New York", parent_ids: [] },
            { id: "53", country: "US", level: 6, name: "New York County", parent_ids: [] },
          ],
          parents: [],
        },
      },
    ]);
    const out = await resolveLocations(newClient(), ["NYC"]);
    expect(out.resolved).toEqual(["16860"]);
    expect(out.ambiguities).toHaveLength(0);
  });

  it("expands a variety of common abbreviations", async () => {
    // Each call hits /geo/search with the expanded canonical name.
    const probes = [
      { input: "SF", expanded: "San Francisco" },
      { input: "L.A.", expanded: "Los Angeles" },
      { input: "DC", expanded: "Washington" },
      { input: "Philly", expanded: "Philadelphia" },
      { input: "Vegas", expanded: "Las Vegas" },
      { input: "Manhattan", expanded: "City of New York" },
    ];
    for (const { input, expanded } of probes) {
      mockHttp([
        {
          method: "GET",
          path: new RegExp(`/geo/search\\?q=${encodeURIComponent(expanded).replace(/%/g, "%")}`),
          status: 200,
          body: {
            results: [{ id: `${input}-id`, country: "US", level: 5, name: expanded, parent_ids: [] }],
            parents: [],
          },
        },
      ]);
      const out = await resolveLocations(newClient(), [input]);
      expect(out.resolved, `alias ${input} → ${expanded}`).toEqual([`${input}-id`]);
    }
  });

  it("prefers a level-5 city over a level-4 state when scores tie", async () => {
    // Genuine same-score case — alphabetically the state appears first
    // in the response but the level preference promotes the city.
    mockHttp([
      {
        method: "GET",
        path: /\/geo\/search\?q=Springfield/,
        status: 200,
        body: {
          results: [
            { id: "state-1", country: "US", level: 4, name: "Springfield", parent_ids: [] },
            { id: "city-1", country: "US", level: 5, name: "Springfield", parent_ids: [] },
          ],
          parents: [],
        },
      },
    ]);
    const out = await resolveLocations(newClient(), ["Springfield"]);
    expect(out.resolved).toEqual(["city-1"]);
  });

  it("mixes resolved + ambiguous across multiple texts", async () => {
    mockHttp([
      {
        method: "GET",
        path: /\/geo\/search\?q=Berlin/,
        status: 200,
        body: {
          results: [{ id: "10", country: "US", level: 8, name: "Berlin", parent_ids: [] }],
          parents: [],
        },
      },
      {
        method: "GET",
        path: /\/geo\/search\?q=Pa/,
        status: 200,
        body: {
          results: [
            { id: "1", country: "US", level: 8, name: "Park", parent_ids: [] },
            { id: "2", country: "US", level: 8, name: "Paris", parent_ids: [] },
          ],
          parents: [],
        },
      },
    ]);
    const out = await resolveLocations(newClient(), ["Berlin", "Pa"]);
    expect(out.resolved).toEqual(["10"]);
    expect(out.ambiguities).toHaveLength(1);
    expect(out.ambiguities[0].location_text).toBe("Pa");
  });
});
