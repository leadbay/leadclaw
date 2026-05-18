import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import { leadbay_dislike_lead as DISLIKE_LEAD_DESCRIPTION } from "../tool-descriptions.generated.js";

interface DislikeLeadParams {
  lead_id: string;
  lens_id?: number;
}

export const dislikeLead: Tool<DislikeLeadParams> = {
  name: "leadbay_dislike_lead",
  annotations: {
    title: "Dislike a lead",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: DISLIKE_LEAD_DESCRIPTION,
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      lead_id: {
        type: "string",
        description: "UUID of the lead to dislike.",
      },
      lens_id: {
        type: "number",
        description: "Lens context. Defaults to the last-active lens if omitted.",
      },
    },
    required: ["lead_id"],
    additionalProperties: false,
  },
  execute: async (client: LeadbayClient, params: DislikeLeadParams) => {
    const lensId = params.lens_id ?? (await client.resolveDefaultLens());
    await client.request<void>("POST", "/interactions", [
      { type: "LEAD_DISLIKED", leadId: params.lead_id, lensId: String(lensId) },
    ]);
    return { applied: true, lead_id: params.lead_id, action: "disliked" };
  },
};
