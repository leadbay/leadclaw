import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";

export const getSelectionIds: Tool<Record<string, never>> = {
  name: "leadbay_get_selection_ids",
  annotations: {
    title: "Read selection ids",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description:
    "List the lead ids currently in the user's selection (the transient set that bulk operations like enrichment act on). " +
    "When to use: to verify the selection state before/after bulk ops if a composite call has misbehaved. " +
    "When NOT to use: in the normal flow — leadbay_enrich_titles manages selection lifecycle automatically (select → action → clear).",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  execute: async (client: LeadbayClient) => {
    return await client.request<string[]>("GET", "/leads/selection/ids");
  },
};
