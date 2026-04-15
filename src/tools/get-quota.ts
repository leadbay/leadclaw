import type { LeadbayClient } from "../client.js";
import type { OrgPayload } from "../types.js";

export function registerGetQuota(api: any, client: LeadbayClient) {
  api.registerTool({
    name: "leadbay_get_quota",
    description:
      "Check organization billing and AI credit quota. Useful before enrichment or qualification operations to verify available credits.",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: async () => {
      const org = await client.request<OrgPayload>("GET", "/organizations");
      return {
        org_name: org.name,
        ai_credits: org.billing?.ai_credits ?? null,
        ai_credits_quota: org.billing?.ai_credits_quota ?? null,
        billing_status: org.billing?.status ?? "unknown",
      };
    },
  });
}
