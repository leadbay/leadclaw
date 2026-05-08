import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";

export const getEnrichmentJobTitles: Tool<Record<string, never>> = {
  name: "leadbay_get_enrichment_job_titles",
  annotations: {
    title: "Read enrichment job titles",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description:
    "List the actual job titles present across the leads currently in the user's selection — " +
    "the candidate set the user can ask to enrich. " +
    "When to use: after leadbay_select_leads, to know which titles are even available before launching a bulk enrichment. " +
    "When NOT to use: standalone — the selection must already be populated, otherwise the result is an empty array. " +
    "leadbay_enrich_titles wraps this whole flow when you don't need to inspect the title list manually.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  execute: async (client: LeadbayClient) => {
    return await client.request<string[]>(
      "GET",
      "/leads/selection/enrichment/job_titles"
    );
  },
};
