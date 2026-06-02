import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { adjustAudience } from "../../../src/composite/adjust-audience.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

const ME = {
  id: "u-1",
  email: "u@example.com",
  organization: { id: "org-1", name: "Acme" },
  admin: false,
  last_requested_lens: 4242,
  language: "en",
};
const USER_LENS = { id: 4242, name: "Mine", user_id: "u-1", is_default: false, default: false };
const SECTORS = [{ id: "1", name: "Fintech" }];
const EMPTY_FILTER = {
  lens_filter: { items: [{ criteria: [] }] },
  locations: { results: [], parents: [] },
};

beforeEach(() => resetHttpMock());

// Regression guard for the live-confirmed backend contract:
//  - POST /filter body must be UNWRAPPED {items:[...]} (NOT {lens_filter,locations})
//  - size criteria need BOTH min and max ("under N" → min defaults to 0)
describe("leadbay_adjust_audience — filter write shape", () => {
  it("POSTs the unwrapped {items:[...]} body, not the wrapped envelope", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME },
      { method: "GET", path: "/1.5/sectors/all?lang=en&includeInvisible=false", status: 200, body: SECTORS },
      { method: "GET", path: "/1.5/lenses/4242", status: 200, body: USER_LENS },
      { method: "GET", path: "/1.5/lenses/4242/filter", status: 200, body: EMPTY_FILTER },
      { method: "POST", path: "/1.5/lenses/4242/filter", status: 200, body: {} },
    ]);

    await adjustAudience.execute(newClient(), { sectors: ["Fintech"] });

    const post = getHttpRequests().find(
      (r) => r.method === "POST" && r.path === "/1.5/lenses/4242/filter"
    );
    const body = JSON.parse(post!.body!);
    expect(body).toHaveProperty("items");
    expect(Array.isArray(body.items)).toBe(true);
    // The wrapped keys must NOT be on the write body.
    expect(body).not.toHaveProperty("lens_filter");
    expect(body).not.toHaveProperty("locations");
    expect(body.items[0].criteria[0]).toMatchObject({ type: "sector_ids", sectors: ["1"] });
  });

  it("size 'under 1000' (max only) is written with min defaulted to 0", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME },
      { method: "GET", path: "/1.5/lenses/4242", status: 200, body: USER_LENS },
      { method: "GET", path: "/1.5/lenses/4242/filter", status: 200, body: EMPTY_FILTER },
      { method: "POST", path: "/1.5/lenses/4242/filter", status: 200, body: {} },
    ]);

    await adjustAudience.execute(newClient(), { sizes: [{ max: 1000 }] });

    const post = getHttpRequests().find(
      (r) => r.method === "POST" && r.path === "/1.5/lenses/4242/filter"
    );
    const body = JSON.parse(post!.body!);
    const sizeCrit = body.items[0].criteria.find((c: any) => c.type === "size");
    expect(sizeCrit.sizes[0]).toEqual({ min: 0, max: 1000 });
  });
});
