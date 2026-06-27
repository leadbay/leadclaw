import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  expectAllScriptsConsumed,
  getHttpRequests,
  httpsMockFactory,
  mockHttp,
  resetHttpMock,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { removeLeadsFromCampaign } from "../../../src/composite/remove-leads-from-campaign.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

describe("remove_leads_from_campaign composite", () => {
  it("DELETEs /campaigns/:id/leads with the lead_ids body and returns the submitted count", async () => {
    mockHttp([
      {
        method: "DELETE",
        path: "/1.6/campaigns/camp-1/leads",
        status: 204,
        body: "",
      },
    ]);

    const result: any = await removeLeadsFromCampaign.execute!(newClient(), {
      campaign_id: "camp-1",
      lead_ids: ["lead-a", "lead-b", "lead-c"],
    });

    expect(result).toEqual({ removed: 3 });

    const reqs = getHttpRequests();
    expect(reqs).toHaveLength(1);
    expect(reqs[0].method).toBe("DELETE");
    expect(reqs[0].path).toBe("/1.6/campaigns/camp-1/leads");
    expect(JSON.parse(reqs[0].body ?? "{}")).toEqual({
      lead_ids: ["lead-a", "lead-b", "lead-c"],
    });
    expectAllScriptsConsumed();
  });

  it("handles a single-lead removal", async () => {
    mockHttp([
      {
        method: "DELETE",
        path: "/1.6/campaigns/camp-9/leads",
        status: 204,
        body: "",
      },
    ]);

    const result: any = await removeLeadsFromCampaign.execute!(newClient(), {
      campaign_id: "camp-9",
      lead_ids: ["only-one"],
    });

    expect(result).toEqual({ removed: 1 });
    expectAllScriptsConsumed();
  });

  it("rejects an empty lead_ids array without hitting the API", async () => {
    mockHttp([]);

    await expect(
      removeLeadsFromCampaign.execute!(newClient(), {
        campaign_id: "camp-1",
        lead_ids: [],
      }),
    ).rejects.toThrow(/lead_ids/);

    expect(getHttpRequests()).toHaveLength(0);
  });

  it("propagates backend errors (e.g. 404 unknown campaign)", async () => {
    mockHttp([
      {
        method: "DELETE",
        path: "/1.6/campaigns/missing/leads",
        status: 404,
        body: { error: "campaign not found" },
      },
    ]);

    await expect(
      removeLeadsFromCampaign.execute!(newClient(), {
        campaign_id: "missing",
        lead_ids: ["lead-a"],
      }),
    ).rejects.toThrow();
    expectAllScriptsConsumed();
  });
});
