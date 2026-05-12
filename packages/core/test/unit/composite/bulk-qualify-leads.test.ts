/**
 * Unit tests for leadbay_bulk_qualify_leads async handle mode.
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
import { bulkQualifyLeads } from "../../../src/composite/bulk-qualify-leads.js";
import { InMemoryBulkStore } from "../../../src/jobs/bulk-store.js";

const BASE = "https://api-us.leadbay.app";

function newClient() {
  return new LeadbayClient(BASE, "u.tok", "us");
}

beforeEach(() => {
  resetHttpMock();
});

describe("leadbay_bulk_qualify_leads", () => {
  it("wait_for_completion=false launches web_fetch and returns without polling", async () => {
    const tracker = new InMemoryBulkStore();
    mockHttp([
      {
        method: "POST",
        path: "/1.5/leads/lead-1/web_fetch?force_fetch=false",
        status: 204,
      },
      {
        method: "POST",
        path: "/1.5/leads/lead-2/web_fetch?force_fetch=false",
        status: 204,
      },
    ]);

    const started = Date.now();
    const out = await bulkQualifyLeads.execute(
      newClient(),
      {
        leadIds: ["lead-1", "lead-2"],
        lensId: 21580,
        wait_for_completion: false,
      },
      { bulkTracker: tracker }
    );

    expect(Date.now() - started).toBeLessThan(5_000);
    expect(out).toMatchObject({
      status: "running",
      handle_id: expect.any(String),
      qualify_id: expect.any(String),
      lead_ids: ["lead-1", "lead-2"],
      launched_count: 2,
      failed: [],
      quota_exceeded: false,
      lens_id: 21580,
    });
    expect(getHttpRequests().map((r) => `${r.method} ${r.path}`)).toEqual([
      "POST /1.5/leads/lead-1/web_fetch?force_fetch=false",
      "POST /1.5/leads/lead-2/web_fetch?force_fetch=false",
    ]);

    const record = await tracker.getQualify(out.qualify_id);
    expect(record?.status).toBe("launched");
    expect(record?.lead_ids).toEqual(["lead-1", "lead-2"]);
  });
});
