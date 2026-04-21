import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";

interface QualifyLeadParams {
  leadId: string;
  forceFetch?: boolean;
}

export const qualifyLead: Tool<QualifyLeadParams> = {
  name: "leadbay_qualify_lead",
  description:
    "Trigger AI qualification for a single lead (web fetch + AI rescore). The operation is asynchronous — " +
    "results take ~60s. " +
    "When to use: low-level. " +
    "When NOT to use: as the agent's bulk-qualify path — use leadbay_bulk_qualify_leads, which paginates past " +
    "already-qualified leads, fan-outs, polls, and bails out cleanly on 429.",
  optional: true,
  inputSchema: {
    type: "object",
    properties: {
      leadId: {
        type: "string",
        description: "Lead UUID (required)",
      },
      forceFetch: {
        type: "boolean",
        description:
          "Force re-fetch even if recent data exists (default: false)",
      },
    },
    required: ["leadId"],
  },
  execute: async (client: LeadbayClient, params: QualifyLeadParams) => {
    const force = params.forceFetch ?? false;
    await client.requestVoid(
      "POST",
      `/leads/${params.leadId}/web_fetch?force_fetch=${force}`
    );
    return {
      triggered: true,
      hint: "AI qualification started. Use leadbay_get_lead_profile after ~60 seconds to check qualification results and web insights.",
    };
  },
};
