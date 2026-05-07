import type { LeadbayClient } from "../client.js";
import type { Tool, NotePayload } from "../types.js";

interface GetLeadNotesParams {
  leadId: string;
}

export const getLeadNotes: Tool<GetLeadNotesParams> = {
  name: "leadbay_get_lead_notes",
  annotations: {
    title: "Read lead notes",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description:
    "Read existing notes on a lead — context the human team or prior agent runs have already captured. " +
    "When to use: before adding a note via leadbay_report_outreach, to avoid duplicating or overwriting context the SDR already wrote. " +
    "When NOT to use: when the lead summary's notes_count is 0 — there's nothing to fetch.",
  inputSchema: {
    type: "object",
    properties: { leadId: { type: "string", description: "Lead UUID (required)" } },
    required: ["leadId"],
  },
  execute: async (client: LeadbayClient, params: GetLeadNotesParams) => {
    return await client.request<NotePayload[]>(
      "GET",
      `/leads/${params.leadId}/notes`
    );
  },
};
