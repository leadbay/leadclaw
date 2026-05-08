import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";

interface SetActiveLensParams {
  lensId: number;
}

export const setActiveLens: Tool<SetActiveLensParams> = {
  name: "leadbay_set_active_lens",
  annotations: {
    title: "Set active lens",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  description:
    "Mark a lens as last-used. Subsequent /me reads return it as last_requested_lens, so all composite " +
    "tools default to it. " +
    "When to use: after the user explicitly switched contexts (e.g. created a new lens via leadbay_create_lens). " +
    "When NOT to use: in normal flow — leadbay_pull_leads and leadbay_adjust_audience auto-set the right lens.",
  optional: true,
  write: true,
  inputSchema: {
    type: "object",
    properties: { lensId: { type: "number", description: "Lens id (required)" } },
    required: ["lensId"],
    additionalProperties: false,
  },
  execute: async (client: LeadbayClient, params: SetActiveLensParams) => {
    await client.requestVoid(
      "POST",
      `/lenses/${params.lensId}/update_last_requested`
    );
    // /me cache holds last_requested_lens — invalidate so next read reflects the change.
    client.invalidateMe();
    client.invalidateDefaultLens();
    return { active_lens_id: params.lensId };
  },
};
