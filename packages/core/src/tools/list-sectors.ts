import type { LeadbayClient } from "../client.js";
import type { Tool, SectorPayload } from "../types.js";

interface ListSectorsParams {
  lang?: string;
  includeInvisible?: boolean;
}

export const listSectors: Tool<ListSectorsParams> = {
  name: "leadbay_list_sectors",
  description:
    "List the sector taxonomy (id + display name in the requested language). " +
    "When to use: to resolve a free-text sector name (e.g. 'Healthcare') into the sector ids " +
    "that leadbay_adjust_audience needs. Default: lang follows the caller's language; " +
    "includeInvisible=false returns ~1,091 visible sectors. " +
    "When NOT to use: when you already have sector ids — pass them directly.",
  inputSchema: {
    type: "object",
    properties: {
      lang: { type: "string", description: "BCP-47 language tag (default: en)" },
      includeInvisible: {
        type: "boolean",
        description:
          "Include sectors hidden from the UI (default false; ~91k items if true)",
      },
    },
  },
  execute: async (client: LeadbayClient, params: ListSectorsParams) => {
    // Prefer the caller's language when not specified — pulls from /me which
    // is cached, so no extra latency in steady state.
    let lang = params.lang;
    if (!lang) {
      try {
        const me = await client.resolveMe();
        lang = me.language ?? "en";
      } catch {
        lang = "en";
      }
    }
    const includeInvisible = params.includeInvisible ? "true" : "false";
    const path = `/sectors/all?lang=${encodeURIComponent(lang)}&includeInvisible=${includeInvisible}`;
    return await client.request<SectorPayload[]>("GET", path);
  },
};
