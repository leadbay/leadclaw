import type { LeadbayClient } from "../client.js";
import type { Tool, UserPromptPayload } from "../types.js";

export const getUserPrompt: Tool<Record<string, never>> = {
  name: "leadbay_get_user_prompt",
  annotations: {
    title: "Read user prompt",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description:
    "Read the org's intelligence-refinement prompt (free-text instruction that steers lead recommendations beyond firmographics). " +
    "Returns null if none is set (the backend returns 204 in that case). " +
    "When to use: to know what's currently steering the agent's recommendations before suggesting a refine. " +
    "When NOT to use: to set/change the prompt — use leadbay_refine_prompt.",
  inputSchema: { type: "object", properties: {} },
  execute: async (client: LeadbayClient) => {
    const orgId = await client.resolveOrgId();
    // /user_prompt returns 204 when unset — request<T>() returns null in that case.
    const prompt = await client.request<UserPromptPayload | null>(
      "GET",
      `/organizations/${orgId}/user_prompt`
    );
    return prompt ?? { prompt: null, set: false };
  },
};
