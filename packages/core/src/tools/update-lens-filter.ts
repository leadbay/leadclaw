import type { LeadbayClient } from "../client.js";
import type { Tool, FilterPayload } from "../types.js";

interface UpdateLensFilterParams {
  lensId: number;
  filter: FilterPayload;
  dry_run?: boolean;
}

export const updateLensFilter: Tool<UpdateLensFilterParams> = {
  name: "leadbay_update_lens_filter",
  annotations: {
    title: "Update lens filter",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  description:
    "Replace the audience filter (sectors, sizes, locations) on a lens. Body is the full Filter object — " +
    "this is a REPLACE, not a merge. Returns 400 'default_lens' if applied to the org default lens (clone it first). " +
    "When to use: low-level mutation when you've already prepared the merged filter. " +
    "When NOT to use: from agent flow — use leadbay_adjust_audience, which handles draft-vs-direct routing, " +
    "permission fallback, and the merge logic so unrelated criteria aren't dropped.",
  optional: true,
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      lensId: { type: "number", description: "Lens id" },
      filter: {
        type: "object",
        description: "Full FilterPayload (lens_filter + locations)",
      },
      dry_run: {
        type: "boolean",
        description:
          "If true, return the call shape that WOULD be sent without contacting the backend",
      },
    },
    required: ["lensId", "filter"],
  },
  execute: async (
    client: LeadbayClient,
    params: UpdateLensFilterParams
  ) => {
    if (params.dry_run) {
      return {
        dry_run: true,
        would_call: {
          method: "POST",
          path: `/lenses/${params.lensId}/filter`,
          body: params.filter,
        },
      };
    }
    await client.requestVoid(
      "POST",
      `/lenses/${params.lensId}/filter`,
      params.filter
    );
    client.invalidateDefaultLens();
    return { updated: true, lens_id: params.lensId };
  },
};
