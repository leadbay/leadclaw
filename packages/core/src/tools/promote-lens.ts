import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";

interface PromoteLensParams {
  lensId: number;
}

export const promoteLens: Tool<PromoteLensParams> = {
  name: "leadbay_promote_lens",
  annotations: {
    title: "Promote a lens draft to active",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  description:
    "Promote a user-level lens (or draft) to org-level so all teammates see it. Admin-only. " +
    "When to use: rare — when an admin user has built a lens (or refined a draft) and wants to share it org-wide. " +
    "When NOT to use: as a non-admin (will fail with 403); for personal lens changes (those stay user-scoped).",
  optional: true,
  write: true,
  inputSchema: {
    type: "object",
    properties: { lensId: { type: "number" } },
    required: ["lensId"],
  },
  execute: async (client: LeadbayClient, params: PromoteLensParams) => {
    await client.requestVoid("POST", `/lenses/${params.lensId}/promote`);
    client.invalidateDefaultLens();
    return { promoted: true, lens_id: params.lensId };
  },
};
