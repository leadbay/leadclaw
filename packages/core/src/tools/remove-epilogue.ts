import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";

interface RemoveEpilogueParams {
  lead_ids: string[];
}

export const removeEpilogue: Tool<RemoveEpilogueParams> = {
  name: "leadbay_remove_epilogue",
  description:
    "Bulk-clear the epilogue status from a set of leads. " +
    "When to use: when an outreach action was logged in error and needs to be undone. " +
    "When NOT to use: to change status — call leadbay_set_epilogue_status with the new status (it overwrites).",
  optional: true,
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      lead_ids: {
        type: "array",
        items: { type: "string" },
        description: "Lead UUIDs",
      },
    },
    required: ["lead_ids"],
  },
  execute: async (client: LeadbayClient, params: RemoveEpilogueParams) => {
    await client.requestVoid("POST", "/leads/remove_epilogue", {
      lead_ids: params.lead_ids,
    });
    return { cleared: true, count: params.lead_ids.length };
  },
};
