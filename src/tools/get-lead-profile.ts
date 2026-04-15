import type { LeadbayClient } from "../client.js";
import type {
  LeadPayload,
  AiAgentResponse,
  ContactPayload,
} from "../types.js";

export function registerGetLeadProfile(api: any, client: LeadbayClient) {
  api.registerTool({
    name: "leadbay_get_lead_profile",
    description:
      "Get a full lead profile including company details, AI qualification scores, and contacts. Bundles three API calls into one response. If qualification or contacts fail, partial data is still returned.",
    parameters: {
      type: "object",
      properties: {
        leadId: {
          type: "string",
          description: "Lead UUID (required)",
        },
        lensId: {
          type: "number",
          description: "Lens ID (optional, auto-resolves to active lens)",
        },
      },
      required: ["leadId"],
    },
    execute: async (params: { leadId: string; lensId?: number }) => {
      const lensId = params.lensId ?? (await client.resolveDefaultLens());

      const [leadResult, qualResult, contactsResult] =
        await Promise.allSettled([
          client.request<LeadPayload>(
            "GET",
            `/lenses/${lensId}/leads/${params.leadId}`
          ),
          client.request<AiAgentResponse[]>(
            "GET",
            `/leads/${params.leadId}/ai_agent_responses`
          ),
          client.request<ContactPayload[]>(
            "GET",
            `/leads/${params.leadId}/contacts?IncludeEnriched=true`
          ),
        ]);

      if (leadResult.status === "rejected") {
        throw leadResult.reason;
      }

      const lead = leadResult.value;

      const qualification =
        qualResult.status === "fulfilled" ? qualResult.value : null;

      const contacts =
        contactsResult.status === "fulfilled" ? contactsResult.value : [];

      return {
        lead: {
          id: lead.id,
          name: lead.name,
          score: lead.score,
          ai_agent_lead_score: lead.ai_agent_lead_score,
          location: lead.location,
          description: lead.description,
          short_description: lead.short_description,
          size: lead.size,
          website: lead.website,
          logo: lead.logo,
          ai_summary: lead.ai_summary,
          split_ai_summary: lead.split_ai_summary,
          tags: lead.tags,
          phone_numbers: lead.phone_numbers,
          keywords: lead.keywords,
          contacts_count: lead.contacts_count,
        },
        qualification: qualification?.map((q) => ({
          question: q.question,
          score: q.score,
          response: q.response,
          computed_at: q.computed_at,
          outdated_at: q.outdated_at,
        })) ?? null,
        contacts: contacts.map((c) => ({
          id: c.id,
          first_name: c.first_name,
          last_name: c.last_name,
          email: c.email,
          phone_number: c.phone_number,
          linkedin_page: c.linkedin_page,
          job_title: c.job_title,
          recommended: c.recommended,
          enrichment: c.enrichment,
        })),
      };
    },
  });
}
