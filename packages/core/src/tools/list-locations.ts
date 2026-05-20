import type { LeadbayClient } from "../client.js";
import type { Tool, GeoSearchResponse } from "../types.js";
import { leadbay_list_locations as LIST_LOCATIONS_DESCRIPTION } from "../tool-descriptions.generated.js";

interface ListLocationsParams {
  q: string;
}

export const listLocations: Tool<ListLocationsParams, GeoSearchResponse> = {
  name: "leadbay_list_locations",
  annotations: {
    title: "Search the geo / admin-area taxonomy",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: LIST_LOCATIONS_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      q: {
        type: "string",
        description:
          "Free-text city / region name (e.g. 'Berlin', 'NYC', 'São Paulo'). Returns top-10 prefix matches sorted by relevance, each with an admin_area id usable in FilterCriterion.location_ids.",
      },
    },
    required: ["q"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      results: {
        type: "array",
        description:
          "Matches sorted by relevance. Each entry: {id, country, level, name, parent_ids}. `level` is admin depth (5=region, 6=county, 7=township-area, 8=city/town).",
        items: { type: "object" },
      },
      parents: {
        type: "array",
        description:
          "Parent admin areas referenced by `results[].parent_ids`, returned for breadcrumb / hover-disambiguation rendering.",
        items: { type: "object" },
      },
    },
    required: ["results", "parents"],
  },
  execute: async (client: LeadbayClient, params: ListLocationsParams) => {
    const q = (params.q ?? "").trim();
    if (!q) return { results: [], parents: [] };
    const path = `/geo/search?q=${encodeURIComponent(q)}`;
    return await client.request<GeoSearchResponse>("GET", path);
  },
};
