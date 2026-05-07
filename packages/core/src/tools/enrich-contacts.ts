import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import type { UserMePayload } from "../types.js";

interface EnrichContactsParams {
  leadId: string;
  contactId: string;
  email?: boolean;
  phone?: boolean;
}

export const enrichContacts: Tool<EnrichContactsParams> = {
  name: "leadbay_enrich_contacts",
  annotations: {
    title: "Enrich contacts for a lead",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  description:
    "Order email and/or phone enrichment for a specific contact. " +
    "When to use: when you have a specific contact_id (from leadbay_get_contacts) and want to enrich just that one. " +
    "When NOT to use: for bulk enrichment by job title across many leads — use leadbay_enrich_titles, which handles " +
    "the selection lifecycle and returns a clean preview/launch flow.",
  optional: true,
  inputSchema: {
    type: "object",
    properties: {
      leadId: {
        type: "string",
        description: "Lead UUID (required)",
      },
      contactId: {
        type: "string",
        description: "Contact UUID (required)",
      },
      email: {
        type: "boolean",
        description: "Enrich email address (default: true)",
      },
      phone: {
        type: "boolean",
        description: "Enrich phone number (default: true)",
      },
    },
    required: ["leadId", "contactId"],
    additionalProperties: false,
  },
  execute: async (client: LeadbayClient, params: EnrichContactsParams) => {
    const email = params.email ?? true;
    const phone = params.phone ?? true;

    if (!email && !phone) {
      throw client.makeError(
        "INVALID_PARAMS",
        "At least one of email or phone must be true",
        "Set email=true or phone=true"
      );
    }

    // Advisory quota check
    let creditsRemaining: number | null = null;
    try {
      const me = await client.request<UserMePayload>("GET", "/users/me");
      creditsRemaining = me.organization.billing?.ai_credits ?? null;
      if (creditsRemaining !== null && creditsRemaining <= 0) {
        throw client.makeError(
          "QUOTA_EXCEEDED",
          "No enrichment credits remaining",
          "Contact Leadbay support to extend your credit quota"
        );
      }
    } catch (e: any) {
      if (e?.code === "QUOTA_EXCEEDED") throw e;
      // Advisory check failed, proceed anyway — server will enforce
    }

    // Try paid contact enrichment path first
    const enrichPath = `/leads/${params.leadId}/enrich/contacts/${params.contactId}/enrich?email=${email}&phone=${phone}`;
    try {
      await client.requestVoid("POST", enrichPath);
    } catch (e: any) {
      if (e?.code === "NOT_FOUND") {
        // Fall back to org contact enrichment path
        const orgPath = `/leads/${params.leadId}/contacts/${params.contactId}/enrich?email=${email}&phone=${phone}`;
        await client.requestVoid("POST", orgPath);
      } else {
        throw e;
      }
    }

    return {
      triggered: true,
      contact_id: params.contactId,
      email_requested: email,
      phone_requested: phone,
      credits_remaining: creditsRemaining,
      hint: "Enrichment started. Use leadbay_get_contacts after ~60 seconds to check results.",
    };
  },
};
