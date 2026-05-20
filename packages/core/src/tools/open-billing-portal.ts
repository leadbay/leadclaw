import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import { leadbay_open_billing_portal as OPEN_BILLING_PORTAL_DESCRIPTION } from "../tool-descriptions.generated.js";

interface StripeUrlResponse {
  url: string;
}

export const openBillingPortal: Tool<Record<string, never>> = {
  name: "leadbay_open_billing_portal",
  annotations: {
    title: "Generate Stripe customer-portal URL for subscription management",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  description: OPEN_BILLING_PORTAL_DESCRIPTION,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  outputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "Stripe customer-portal URL. Surface as a clickable link; the user manages subscription / payment methods / invoices in their browser.",
      },
    },
    required: ["url"],
  },
  execute: async (client: LeadbayClient) => {
    return await client.request<StripeUrlResponse>("GET", "/stripe/portal");
  },
};
