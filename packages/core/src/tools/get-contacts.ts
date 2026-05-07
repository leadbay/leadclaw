import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import type { ContactPayload, PaidContactPayload } from "../types.js";

interface GetContactsParams {
  leadId: string;
}

export const getContacts: Tool<GetContactsParams> = {
  name: "leadbay_get_contacts",
  annotations: {
    title: "Read enriched contacts",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description:
    "Get contacts for a lead, including enriched email and phone data. Returns both organization contacts and enrichable contacts with IDs. " +
    "When to use: to check enrichment status (contact.enrichment.done) on individual leads after a bulk enrichment was launched, " +
    "or to find the contact_id needed by leadbay_enrich_contacts. " +
    "When NOT to use: as a substitute for leadbay_research_lead, which already includes enriched contacts in its return.",
  inputSchema: {
    type: "object",
    properties: {
      leadId: {
        type: "string",
        description: "Lead UUID (required)",
      },
    },
    required: ["leadId"],
  },
  execute: async (client: LeadbayClient, params: GetContactsParams) => {
    const [orgResult, paidResult] = await Promise.allSettled([
      client.request<ContactPayload[]>(
        "GET",
        `/leads/${params.leadId}/contacts?IncludeEnriched=true`
      ),
      client.request<PaidContactPayload[]>(
        "GET",
        `/leads/${params.leadId}/enrich/contacts?IncludeEnriched=true`
      ),
    ]);

    const orgContacts =
      orgResult.status === "fulfilled" ? orgResult.value : [];
    const paidContacts =
      paidResult.status === "fulfilled" ? paidResult.value : [];

    return {
      contacts: [
        ...orgContacts.map((c) => ({
          id: c.id,
          first_name: c.first_name,
          last_name: c.last_name,
          email: c.email,
          phone_number: c.phone_number,
          linkedin_page: c.linkedin_page,
          job_title: c.job_title,
          recommended: c.recommended,
          enrichment: c.enrichment,
          source: "org" as const,
        })),
        ...paidContacts.map((c) => ({
          id: c.id,
          first_name: c.first_name,
          last_name: c.last_name,
          email: c.email,
          phone_number: c.phone_number,
          linkedin_page: c.linkedin_page,
          job_title: c.job_title,
          recommended: c.recommended,
          enrichment: c.enrichment,
          source: "paid" as const,
        })),
      ],
    };
  },
};
