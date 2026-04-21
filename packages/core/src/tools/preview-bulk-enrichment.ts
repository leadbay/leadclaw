import type { LeadbayClient } from "../client.js";
import type { Tool, BulkEnrichPreview } from "../types.js";

interface PreviewBulkEnrichmentParams {
  titles: string[];
}

export const previewBulkEnrichment: Tool<PreviewBulkEnrichmentParams> = {
  name: "leadbay_preview_bulk_enrichment",
  description:
    "Preview a bulk-enrichment cost given a set of job titles applied to the current selection. Returns " +
    "{selected_leads, enriched_contacts, enrichable_contacts, title_suggestions, auto_included_titles, previously_enriched_titles}. " +
    "previously_enriched_titles is a newer field (in prod soon) — when present, the agent can recommend " +
    "repeating those titles for new leads. " +
    "When to use: between selecting leads and launching, to know what the enrichment will cost. " +
    "When NOT to use: from agent flow — leadbay_enrich_titles wraps preview + launch with the right safety checks.",
  optional: true,
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      titles: {
        type: "array",
        items: { type: "string" },
        description: "Job titles to enrich (matched against contacts in selected leads)",
      },
    },
    required: ["titles"],
  },
  execute: async (
    client: LeadbayClient,
    params: PreviewBulkEnrichmentParams
  ) => {
    return await client.request<BulkEnrichPreview>(
      "POST",
      "/leads/selection/enrichment/preview",
      { titles: params.titles }
    );
  },
};
