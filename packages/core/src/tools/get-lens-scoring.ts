import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";

interface GetLensScoringParams {
  lensId: number;
}

interface LensScoringPayload {
  criteria?: unknown;
  [k: string]: unknown;
}

export const getLensScoring: Tool<GetLensScoringParams> = {
  name: "leadbay_get_lens_scoring",
  description:
    "Read the AI-scoring criteria configured on a lens (what makes a lead score 100 vs 30). " +
    "When to use: when explaining why a lead got the score it did. " +
    "When NOT to use: to mutate scoring — that's an admin/setup operation, not part of the agent loop.",
  inputSchema: {
    type: "object",
    properties: { lensId: { type: "number", description: "Lens id (required)" } },
    required: ["lensId"],
  },
  execute: async (client: LeadbayClient, params: GetLensScoringParams) => {
    return await client.request<LensScoringPayload>(
      "GET",
      `/lenses/${params.lensId}/scoring`
    );
  },
};
