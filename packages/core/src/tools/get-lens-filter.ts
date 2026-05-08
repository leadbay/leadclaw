import type { LeadbayClient } from "../client.js";
import type { Tool, FilterPayload } from "../types.js";

interface GetLensFilterParams {
  lensId: number;
}

export const getLensFilter: Tool<GetLensFilterParams> = {
  name: "leadbay_get_lens_filter",
  annotations: {
    title: "Read lens filter",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description:
    "Read the firmographic filter (sectors, sizes, locations) currently applied to a lens. " +
    "When to use: before adjusting an audience — see what's already restricted so changes are diffs, not full replacements. " +
    "When NOT to use: to actually apply changes — use the leadbay_adjust_audience composite, which handles permissions transparently.",
  inputSchema: {
    type: "object",
    properties: {
      lensId: { type: "number", description: "Lens id (required)" },
    },
    required: ["lensId"],
    additionalProperties: false,
  },
  execute: async (client: LeadbayClient, params: GetLensFilterParams) => {
    return await client.request<FilterPayload>(
      "GET",
      `/lenses/${params.lensId}/filter`
    );
  },
};
