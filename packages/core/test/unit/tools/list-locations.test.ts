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
import { listLocations } from "../../../src/tools/list-locations.js";

const BASE = "https://api-us.leadbay.app";

function newClient() {
  return new LeadbayClient(BASE, "u.test-token", "us");
}

beforeEach(() => resetHttpMock());

describe("leadbay_list_locations", () => {
  it("hits /1.5/geo/search?q= and returns the {results, parents} envelope", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.5/geo/search?q=Paris",
        status: 200,
        body: {
          results: [
            { id: "416102", country: "US", level: 8, name: "Paris", parent_ids: ["416102", "416103"] },
          ],
          parents: [
            { id: "416103", country: "US", level: 6, name: "Edgar County", parent_ids: [] },
          ],
        },
      },
    ]);

    const result = await listLocations.execute(newClient(), { q: "Paris" });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe("416102");
    expect(result.parents).toHaveLength(1);

    const reqs = getHttpRequests();
    expect(reqs).toHaveLength(1);
    expect(reqs[0].path).toBe("/1.5/geo/search?q=Paris");
  });

  it("returns empty envelope without hitting the backend when q is empty", async () => {
    mockHttp([]);
    const result = await listLocations.execute(newClient(), { q: "  " });
    expect(result).toEqual({ results: [], parents: [] });
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("URL-encodes special characters in the query", async () => {
    mockHttp([
      {
        method: "GET",
        path: /\/1\.5\/geo\/search\?q=S%C3%A3o%20Paulo/,
        status: 200,
        body: { results: [], parents: [] },
      },
    ]);
    await listLocations.execute(newClient(), { q: "São Paulo" });
    const reqs = getHttpRequests();
    expect(reqs[0].path).toContain("S%C3%A3o%20Paulo");
  });

});
