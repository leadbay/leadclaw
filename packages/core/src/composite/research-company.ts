import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";
import { discoverLeads } from "../tools/discover-leads.js";
import { getLeadProfile } from "../tools/get-lead-profile.js";
import { getLeadActivities } from "../tools/get-lead-activities.js";

interface ResearchCompanyParams {
  companyName?: string;
  leadId?: string;
}

export const researchCompany: Tool<ResearchCompanyParams> = {
  name: "leadbay_research_company",
  description:
    "Deep-dive research on a specific company by NAME (fuzzy match against the active lens's wishlist). " +
    "When to use: when the user references a company by name and you don't yet have its lead_id. " +
    "When NOT to use: when you already have the lead_id — use leadbay_research_lead directly (it bundles " +
    "richer signals + better top-down ordering for the agent).",
  inputSchema: {
    type: "object",
    properties: {
      companyName: {
        type: "string",
        description:
          "Company name to research (one of companyName or leadId required). Matches the top-scoring lead with this name.",
      },
      leadId: {
        type: "string",
        description:
          "Lead UUID if already known (one of companyName or leadId required). Takes precedence over companyName.",
      },
    },
  },
  execute: async (
    client: LeadbayClient,
    params: ResearchCompanyParams,
    ctx?: ToolContext
  ) => {
    if (!params.leadId && !params.companyName) {
      throw client.makeError(
        "INVALID_PARAMS",
        "Pass either leadId or companyName",
        "Call leadbay_pull_leads first to surface candidate leads with their IDs, then call this with leadId."
      );
    }

    let leadId = params.leadId;

    if (!leadId && params.companyName) {
      // Try to match by scanning the first page of the active lens
      const results = await discoverLeads.execute(
        client,
        { count: 50, page: 0 },
        ctx
      );
      const needle = params.companyName.toLowerCase();
      const match = (results.leads as Array<{ id: string; name: string }>).find(
        (l) => l.name.toLowerCase().includes(needle)
      );
      if (!match) {
        throw client.makeError(
          "LEAD_NOT_FOUND",
          `No lead matching "${params.companyName}" in the current lens`,
          "Call leadbay_pull_leads (optionally with a broader lensId) to see what's available, then call this with leadId."
        );
      }
      leadId = match.id;
    }

    const [profile, activities] = await Promise.allSettled([
      getLeadProfile.execute(client, { leadId: leadId! }, ctx),
      getLeadActivities.execute(client, { leadId: leadId!, count: 20 }, ctx),
    ]);

    if (profile.status === "rejected") {
      throw profile.reason;
    }

    return {
      ...profile.value,
      recent_activities:
        activities.status === "fulfilled" ? activities.value.activities : [],
    };
  },
};
