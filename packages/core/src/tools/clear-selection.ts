import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";

export const clearSelection: Tool<Record<string, never>> = {
  name: "leadbay_clear_selection",
  annotations: {
    title: "Clear selection",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  description:
    "Clear the user's transient selection. " +
    "When to use: cleanup after manual selection work, or recovery from a stuck composite. " +
    "When NOT to use: in normal flow — composites clear in their own finally blocks.",
  optional: true,
  write: true,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  execute: async (client: LeadbayClient) => {
    await client.requestVoid("POST", "/leads/selection/clear");
    return { cleared: true };
  },
};
