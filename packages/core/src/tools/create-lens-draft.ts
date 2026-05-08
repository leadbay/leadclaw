import type { LeadbayClient } from "../client.js";
import type { Tool, LensPayload } from "../types.js";

interface CreateLensDraftParams {
  lensId: number;
}

export const createLensDraft: Tool<CreateLensDraftParams> = {
  name: "leadbay_create_lens_draft",
  annotations: {
    title: "Create a lens draft",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  description:
    "Create (or fetch existing) draft of an org-level lens. Idempotent — same user calling twice returns " +
    "the same draft. The returned lens has draft_of set to the original lens id. " +
    "When to use: when a non-admin needs to modify an org-level lens — make a draft, edit the draft. " +
    "When NOT to use: from agent flow — leadbay_adjust_audience handles the draft-routing transparently.",
  optional: true,
  write: true,
  inputSchema: {
    type: "object",
    properties: { lensId: { type: "number", description: "Lens id of the org-level lens to draft" } },
    required: ["lensId"],
    additionalProperties: false,
  },
  execute: async (client: LeadbayClient, params: CreateLensDraftParams) => {
    return await client.request<LensPayload>(
      "POST",
      `/lenses/${params.lensId}/draft`
    );
  },
};
