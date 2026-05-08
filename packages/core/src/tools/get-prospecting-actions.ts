import type { LeadbayClient } from "../client.js";
import type { Tool, ProspectingActionsPayload } from "../types.js";

interface GetProspectingActionsParams {
  leadId: string;
  count?: number;
  page?: number;
}

export const getProspectingActions: Tool<GetProspectingActionsParams> = {
  name: "leadbay_get_prospecting_actions",
  annotations: {
    title: "Read prospecting actions",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description:
    "Read the CRM-style activity log for a lead (calls, emails, meetings — actions performed by humans or prior agent runs). " +
    "When to use: before contacting the lead, to avoid duplicating outreach the team already did. " +
    "When NOT to use: when the lead summary's prospecting_actions_count is 0.",
  inputSchema: {
    type: "object",
    properties: {
      leadId: { type: "string", description: "Lead UUID (required)" },
      count: { type: "number", description: "Items per page (1-200, default 20)" },
      page: { type: "number", description: "Page number, 0-indexed (default 0)" },
    },
    required: ["leadId"],
    additionalProperties: false,
  },
  execute: async (
    client: LeadbayClient,
    params: GetProspectingActionsParams
  ) => {
    const count = params.count ?? 20;
    const page = params.page ?? 0;
    return await client.request<ProspectingActionsPayload>(
      "GET",
      `/leads/${params.leadId}/prospecting_actions?count=${count}&page=${page}`
    );
  },
};
