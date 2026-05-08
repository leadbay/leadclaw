import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";

interface UpdateLensParams {
  lensId: number;
  name?: string;
  description?: string;
  multi_product_mode?: boolean;
  use_hq_only?: boolean;
}

export const updateLens: Tool<UpdateLensParams> = {
  name: "leadbay_update_lens",
  annotations: {
    title: "Update a lens",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  description:
    "Update lens metadata (name, description, mode flags). Does NOT change the audience filter — use " +
    "leadbay_update_lens_filter for that. " +
    "When to use: rename a lens or toggle multi_product_mode/use_hq_only. " +
    "When NOT to use: to change which leads the lens shows — that's a filter operation.",
  optional: true,
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      lensId: { type: "number" },
      name: { type: "string" },
      description: { type: "string" },
      multi_product_mode: { type: "boolean" },
      use_hq_only: { type: "boolean" },
    },
    required: ["lensId"],
    additionalProperties: false,
  },
  execute: async (client: LeadbayClient, params: UpdateLensParams) => {
    const { lensId, ...body } = params;
    await client.requestVoid("POST", `/lenses/${lensId}`, body);
    client.invalidateDefaultLens();
    return { updated: true, lens_id: lensId };
  },
};
