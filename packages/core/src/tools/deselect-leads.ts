// IMPORTANT: /leads/selection/deselect takes leadIds as repeated query params,
// same shape as /select. See SHAPE-DRIFT.md.

import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";

interface DeselectLeadsParams {
  leadIds: string[];
}

export const deselectLeads: Tool<DeselectLeadsParams> = {
  name: "leadbay_deselect_leads",
  annotations: {
    title: "Deselect leads",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  description:
    "Remove leads from the user's transient selection. " +
    "When to use: when narrowing a previously-built selection without clearing it entirely. " +
    "When NOT to use: in normal flow — leadbay_enrich_titles handles selection lifecycle.",
  optional: true,
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      leadIds: {
        type: "array",
        items: { type: "string" },
        description: "Lead UUIDs to remove from selection",
        minItems: 1,
      },
    },
    required: ["leadIds"],
  },
  execute: async (client: LeadbayClient, params: DeselectLeadsParams) => {
    const qs = params.leadIds
      .map((id) => `leadIds=${encodeURIComponent(id)}`)
      .join("&");
    await client.requestVoid("POST", `/leads/selection/deselect?${qs}`);
    return { deselected: params.leadIds.length };
  },
};
