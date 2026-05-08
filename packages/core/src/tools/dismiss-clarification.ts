import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";

export const dismissClarification: Tool<Record<string, never>> = {
  name: "leadbay_dismiss_clarification",
  annotations: {
    title: "Dismiss a clarification",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  description:
    "Dismiss the pending clarification without answering. Leadbay proceeds with its best guess. Admin-only. " +
    "When to use: when the user explicitly doesn't want to answer the disambiguation. " +
    "When NOT to use: as a default — answering with even a free-text reason gives Leadbay better signal.",
  optional: true,
  write: true,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  execute: async (client: LeadbayClient) => {
    const orgId = await client.resolveOrgId();
    await client.requestVoid(
      "POST",
      `/organizations/${orgId}/dismiss_clarification`
    );
    // Dismissing clears the pending clarification on the org — that state
    // bleeds into /me via computing_intelligence reset. Invalidate cache.
    client.invalidateMe();
    return { dismissed: true };
  },
};
