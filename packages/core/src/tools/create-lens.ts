import type { LeadbayClient } from "../client.js";
import type { Tool, LensPayload } from "../types.js";

interface CreateLensParams {
  base: number;
  name: string;
  description?: string;
}

export const createLens: Tool<CreateLensParams> = {
  name: "leadbay_create_lens",
  annotations: {
    title: "Create a new lens",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  description:
    "Create a new user-level lens by cloning an existing lens's filter/scoring as the starting point. " +
    "When to use: when adjust_audience determined the current lens cannot be edited (e.g. it's the org default). " +
    "When NOT to use: to update an existing lens — use leadbay_update_lens or leadbay_update_lens_filter.",
  optional: true,
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      base: { type: "number", description: "Base lens id to clone from" },
      name: { type: "string", description: "Display name for the new lens" },
      description: { type: "string" },
    },
    required: ["base", "name"],
    additionalProperties: false,
  },
  execute: async (client: LeadbayClient, params: CreateLensParams) => {
    const lens = await client.request<LensPayload>("POST", "/lenses", {
      base: params.base,
      name: params.name,
      description: params.description,
    });
    // /me's last_requested_lens is unchanged by creation, but the lens-list
    // cache the client maintains is now stale.
    client.invalidateDefaultLens();
    return lens;
  },
};
