// Deterministic regression lock for the sector-creation crash class
// (telemetry 30d ending 2026-06-12: adjust_audience 61% fail, 19 TypeError).
//
// Mirrors the MCP eval scenario
// packages/mcp/test/eval/scenarios/lens-creation/new-lens-string-base.scenario.ts,
// at the deterministic unit layer (the scenario-runner glue is not wired on
// this branch, and the bug is deterministic — an HTTP-shape assertion, not an
// LLM judgement). New file per the repo invariant: never edit existing tests.
//
// What it locks (new-lens.ts:192): the POST /lenses body MUST carry `base` as
// a STRING. A numeric base yields a 400 "JSON deserialization error" and the
// lens is never created. RED proof: reverting `String(base)` to a bare `base`
// makes "base is a string" fail.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { newLens } from "../../../src/composite/new-lens.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

const ME = {
  id: "u-1",
  email: "u@example.com",
  organization: { id: "org-1", name: "Acme" },
  language: "en",
  last_requested_lens: 39107,
};

// Clean Fintech match + a DIRTY null-name row (same shape that crashed the
// taxonomy scan pre-fix) + an unrelated sector.
const SECTORS = [
  { id: "1", name: "Fintech" },
  { id: "2", name: null },
  { id: "3", name: "Plomberie" },
];

beforeEach(() => resetHttpMock());

describe("leadbay_new_lens — string-base regression (sector-creation crash class)", () => {
  it("POST /lenses sends `base` as a STRING and creates the lens (no deserialization error)", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME },
      {
        method: "GET",
        path: "/1.5/sectors/all?lang=en&includeInvisible=false",
        status: 200,
        body: SECTORS,
      },
      {
        method: "POST",
        path: "/1.5/lenses",
        status: 200,
        body: { id: 555, name: "Joinery", user_id: "u-1" },
      },
      { method: "POST", path: "/1.5/lenses/555/filter", status: 200, body: {} },
    ]);

    const result: any = await newLens.execute(newClient(), {
      name: "Joinery",
      sectors: ["Fintech"],
      base: 39107, // numeric base from the rest of the codebase
      confirm: true,
    });

    // Graceful success — NOT an API_ERROR / deserialization error.
    expect(result.status).toBe("created");
    expect(result.lens).toEqual({ id: 555, name: "Joinery" });

    const createPost = getHttpRequests().find(
      (r) => r.method === "POST" && r.path === "/1.5/lenses"
    );
    expect(createPost).toBeDefined();
    const createBody = JSON.parse(createPost!.body!);
    // THE LOAD-BEARING ASSERTION: base is coerced to a string. Reverting the
    // String(base) coercion in new-lens.ts makes this fail (RED).
    expect(typeof createBody.base).toBe("string");
    expect(createBody.base).toBe("39107");
  });

  it("POST /lenses/:id/filter sends the UNWRAPPED {items:[...]} body, not the envelope", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME },
      {
        method: "GET",
        path: "/1.5/sectors/all?lang=en&includeInvisible=false",
        status: 200,
        body: SECTORS,
      },
      {
        method: "POST",
        path: "/1.5/lenses",
        status: 200,
        body: { id: 555, name: "Joinery", user_id: "u-1" },
      },
      { method: "POST", path: "/1.5/lenses/555/filter", status: 200, body: {} },
    ]);

    await newLens.execute(newClient(), {
      name: "Joinery",
      sectors: ["Fintech"],
      base: 39107,
      confirm: true,
    });

    const filterPost = getHttpRequests().find(
      (r) => r.method === "POST" && r.path === "/1.5/lenses/555/filter"
    );
    expect(filterPost).toBeDefined();
    const filterBody = JSON.parse(filterPost!.body!);
    expect(Array.isArray(filterBody.items)).toBe(true);
    expect(filterBody.lens_filter).toBeUndefined();
    // The resolved Fintech id made it into the unwrapped criteria.
    const sectorCrit = filterBody.items[0].criteria.find(
      (c: any) => c.type === "sector_ids"
    );
    expect(sectorCrit.sectors).toContain("1");
  });

  it("a null-name taxonomy row does not crash lens creation", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME },
      {
        method: "GET",
        path: "/1.5/sectors/all?lang=en&includeInvisible=false",
        status: 200,
        body: SECTORS, // contains {id:"2", name:null}
      },
      {
        method: "POST",
        path: "/1.5/lenses",
        status: 200,
        body: { id: 555, name: "Joinery", user_id: "u-1" },
      },
      { method: "POST", path: "/1.5/lenses/555/filter", status: 200, body: {} },
    ]);

    // Pre-fix this threw a TypeError while scanning the null-name row.
    await expect(
      newLens.execute(newClient(), {
        name: "Joinery",
        sectors: ["Fintech"],
        base: 39107,
        confirm: true,
      })
    ).resolves.toMatchObject({ status: "created" });
  });
});
