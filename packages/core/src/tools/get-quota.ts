import type { LeadbayClient } from "../client.js";
import type { Tool, QuotaStatusPayload } from "../types.js";

export const getQuota: Tool<Record<string, never>> = {
  name: "leadbay_get_quota",
  description:
    "Read remaining quota / spend across daily, weekly, monthly windows for the org's resources " +
    "(llm_completion, ai_rescore, web_fetch). Each entry shows current_units vs max_units and resets_at. " +
    "When to use: after a 429 error, to explain to the user which window was hit and when it resets. " +
    "When NOT to use: as a pre-flight gate before bulk operations — operations themselves return 429 with hints; " +
    "this tool is for diagnostics, not gating.",
  inputSchema: { type: "object", properties: {} },
  execute: async (client: LeadbayClient) => {
    const orgId = await client.resolveOrgId();
    return await client.request<QuotaStatusPayload>(
      "GET",
      `/organizations/${orgId}/quota_status`
    );
  },
};
