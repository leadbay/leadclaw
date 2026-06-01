/**
 * leadbay_new_lens — create a named lens with sectors/sizes in one call.
 *
 * Default-surface composite. Clones a base lens (the active/default unless
 * `base` is given), names it, resolves free-text sectors against the taxonomy
 * (reusing adjust-audience's resolver so the ambiguity contract is identical),
 * and applies the filter — all in one step. Does NOT switch the active lens
 * (consistent with adjust_audience lensName); NEXT STEPS offers the switch.
 *
 * Distinct name from the granular leadbay_create_lens (POST /lenses) so the
 * tool-name identity audit doesn't collide when ADVANCED=1.
 *
 * Sectors that don't resolve are surfaced as ambiguous_sectors and the lens is
 * NOT created — we never leave a half-built lens behind.
 */
import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext, LensPayload, FilterPayload } from "../types.js";
import { resolveSectors, mergeFilter } from "./adjust-audience.js";

import { leadbay_new_lens as NEW_LENS_DESCRIPTION } from "../tool-descriptions.generated.js";

interface NewLensParams {
  name: string;
  sectors?: string[];
  exclude_sectors?: string[];
  sizes?: Array<{ min?: number; max?: number }>;
  base?: number; // lens id to clone from; defaults to the active/default lens
  description?: string;
}

const EMPTY_FILTER: FilterPayload = {
  lens_filter: { items: [{ criteria: [] }] },
  locations: { results: [], parents: [] },
};

export const newLens: Tool<NewLensParams> = {
  name: "leadbay_new_lens",
  annotations: {
    title: "Create a new named lens",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false, // each call creates a distinct lens
    openWorldHint: true,
  },
  description: NEW_LENS_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Display name for the new lens (required)." },
      sectors: {
        type: "array",
        items: { type: "string" },
        description: "Sectors to include — free text (auto-resolved) or ids.",
      },
      exclude_sectors: {
        type: "array",
        items: { type: "string" },
        description: "Sectors to exclude — free text or ids.",
      },
      sizes: {
        type: "array",
        items: {
          type: "object",
          properties: { min: { type: "number" }, max: { type: "number" } },
        },
        description: "Company size buckets, e.g. [{min:30,max:300}].",
      },
      base: {
        type: "number",
        description:
          "Lens id to clone from. Defaults to the active/default lens.",
      },
      description: { type: "string", description: "Optional lens description." },
    },
    required: ["name"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    description:
      "'created' on success; 'ambiguous_sectors' when free-text sectors didn't resolve (re-call with sector ids — the lens was NOT created).",
    properties: {
      status: { type: "string", description: "'created' or 'ambiguous_sectors'." },
      lens: {
        type: "object",
        description: "The created lens: {id, name}.",
      },
      sector_ambiguities: {
        type: "array",
        description:
          "On 'ambiguous_sectors': per text {sector_text, matches:[{id,name,score}]}.",
        items: { type: "object" },
      },
      filter_applied: { type: "object", description: "The FilterPayload POSTed to the new lens." },
      message: { type: "string" },
      _meta: { type: "object" },
    },
    required: ["status"],
  },
  execute: async (
    client: LeadbayClient,
    params: NewLensParams,
    ctx?: ToolContext
  ) => {
    // 1. Resolve sectors FIRST — if any don't resolve, surface and bail before
    //    creating a lens, so we never leave a half-built lens behind.
    const includeRes = await resolveSectors(
      client,
      params.sectors ?? [],
      ctx
    );
    const excludeRes = await resolveSectors(
      client,
      params.exclude_sectors ?? [],
      ctx
    );
    const ambiguities = [...includeRes.ambiguities, ...excludeRes.ambiguities];
    if (ambiguities.length > 0) {
      const noMatch = ambiguities.filter((a) => a.matches.length === 0);
      const multi = ambiguities.filter((a) => a.matches.length > 0);
      const parts: string[] = [];
      if (noMatch.length > 0) {
        parts.push(
          `Couldn't find a sector matching ${noMatch
            .map((a) => `"${a.sector_text}"`)
            .join(", ")}. Pick a known sector and re-call (lens not yet created).`
        );
      }
      if (multi.length > 0) {
        parts.push(
          `${multi
            .map((a) => `"${a.sector_text}"`)
            .join(", ")} matched multiple sectors. Pick from the matches and re-call with the sector id.`
        );
      }
      return {
        status: "ambiguous_sectors",
        sector_ambiguities: ambiguities,
        message: parts.join(" "),
      };
    }

    // 2. Resolve the base lens to clone from.
    const base = params.base ?? (await client.resolveDefaultLens());

    // 3. Create the lens.
    const created = await client.request<LensPayload>("POST", "/lenses", {
      base,
      name: params.name,
      description: params.description,
    });

    // 4. Apply the filter (sectors/sizes) to the fresh lens.
    const merged = mergeFilter(
      EMPTY_FILTER,
      includeRes.resolved,
      excludeRes.resolved,
      params.sizes
    );
    const hasCriteria = merged.lens_filter.items[0].criteria.length > 0;
    if (hasCriteria) {
      await client.requestVoid("POST", `/lenses/${created.id}/filter`, merged);
    }

    // The lens list cache the client maintains is now stale.
    client.invalidateDefaultLens();

    return {
      status: "created",
      lens: { id: created.id, name: created.name },
      filter_applied: merged,
      message: `Created "${created.name}".`,
      _meta: { region: client.region },
    };
  },
};
