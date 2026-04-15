import type { LeadbayClient } from "../client.js";
import type { ContactPayload } from "../types.js";

export function registerGetContacts(api: any, client: LeadbayClient) {
  api.registerTool({
    name: "leadbay_get_contacts",
    description:
      "Get contacts for a lead, including enriched email and phone data if enrichment has completed.",
    parameters: {
      type: "object",
      properties: {
        leadId: {
          type: "string",
          description: "Lead UUID (required)",
        },
      },
      required: ["leadId"],
    },
    execute: async (params: { leadId: string }) => {
      const contacts = await client.request<ContactPayload[]>(
        "GET",
        `/leads/${params.leadId}/contacts?IncludeEnriched=true`
      );
      return {
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
