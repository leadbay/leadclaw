import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";

export const clearUserPrompt: Tool<Record<string, never>> = {
  name: "leadbay_clear_user_prompt",
  annotations: {
    title: "Clear the user prompt",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  description:
    "Remove the org's intelligence-refinement prompt (revert to AI-only generation). Admin-only. " +
    "Triggers full intelligence regeneration. " +
    "When to use: when a refinement turned out to be the wrong direction. " +
    "When NOT to use: to replace with a different prompt — just call leadbay_refine_prompt; that overwrites.",
  optional: true,
  write: true,
  inputSchema: { type: "object", properties: {} },
  execute: async (client: LeadbayClient) => {
    const orgId = await client.resolveOrgId();
    await client.requestVoid("DELETE", `/organizations/${orgId}/user_prompt`);
    // Mutates organization.computing_intelligence — invalidate /me cache.
    client.invalidateMe();
    return { cleared: true };
  },
};
