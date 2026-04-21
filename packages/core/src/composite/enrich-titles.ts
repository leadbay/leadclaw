import type { LeadbayClient } from "../client.js";
import type {
  Tool,
  ToolContext,
  BulkEnrichPreview,
  WishlistResponse,
} from "../types.js";

interface EnrichTitlesParams {
  titles?: string[];
  leadIds?: string[];
  lensId?: number;
  email?: boolean;
  phone?: boolean;
  candidateCount?: number;
  dry_run?: boolean;
}

const DEFAULT_CANDIDATE_COUNT = 25;

export const enrichTitles: Tool<EnrichTitlesParams> = {
  name: "leadbay_enrich_titles",
  description:
    "Order contact enrichments by job title across many leads. Two modes: " +
    "(A) NO titles param — returns the available titles + Leadbay's title_suggestions + auto_included_titles " +
    "+ a count of enrichable contacts, so the agent can ask the user which titles to enrich. " +
    "(B) titles given — calls preview, then launches if there's anything enrichable. " +
    "On 429 returns {status:'quota_exceeded'} cleanly. Selection lifecycle is wrapped in a try/finally so the " +
    "user's selection is left clean even on error. " +
    "When to use: as the agent's go-to enrichment entry point. " +
    "When NOT to use: to enrich a single contact — that's leadbay_enrich_contacts (granular).",
  inputSchema: {
    type: "object",
    properties: {
      titles: {
        type: "array",
        items: { type: "string" },
        description:
          "Job titles to enrich. Omit to discover what's available without launching.",
      },
      leadIds: {
        type: "array",
        items: { type: "string" },
        description:
          "Lead UUIDs to enrich. Omit to use the top page of the active lens's wishlist.",
      },
      lensId: {
        type: "number",
        description: "Lens id (escape hatch — defaults to active)",
      },
      email: { type: "boolean", description: "Enrich emails (default true)" },
      phone: { type: "boolean", description: "Enrich phone numbers (default false)" },
      candidateCount: {
        type: "number",
        description: `When leadIds is omitted, how many top-of-wishlist leads to use (default ${DEFAULT_CANDIDATE_COUNT})`,
      },
      dry_run: {
        type: "boolean",
        description: "If true, don't launch — only preview.",
      },
    },
  },
  execute: async (
    client: LeadbayClient,
    params: EnrichTitlesParams,
    ctx?: ToolContext
  ) => {
    const email = params.email ?? true;
    const phone = params.phone ?? false;

    if (!email && !phone) {
      return {
        error: true,
        code: "BAD_INPUT",
        message: "Either email or phone must be true",
        hint: "Set email:true (most common) or phone:true",
      };
    }

    let leadIds = params.leadIds;
    if (!leadIds || leadIds.length === 0) {
      const lensId = params.lensId ?? (await client.resolveDefaultLens());
      const cnt = params.candidateCount ?? DEFAULT_CANDIDATE_COUNT;
      const wish = await client.request<WishlistResponse>(
        "GET",
        `/lenses/${lensId}/leads/wishlist?count=${Math.min(cnt, 50)}&page=0`
      );
      leadIds = wish.items.map((l) => l.id);
    }

    if (leadIds.length === 0) {
      return {
        error: true,
        code: "NO_CANDIDATES",
        message: "No candidate leads",
        hint: "Pass leadIds explicitly or wait for the wishlist to compute",
      };
    }

    // Acquire selection lock — global state per token, must serialise.
    await client.acquireSelectionLock();
    try {
      const qs = leadIds
        .map((id) => `leadIds=${encodeURIComponent(id)}`)
        .join("&");
      await client.requestVoid("POST", `/leads/selection/select?${qs}`);

      try {
        // Get titles available across this selection.
        const availableTitles = await client.request<string[]>(
          "GET",
          "/leads/selection/enrichment/job_titles"
        );

        if (!params.titles || params.titles.length === 0) {
          // Branch A — discovery. Run a 0-titles preview to surface
          // title_suggestions / auto_included_titles / previously_enriched_titles.
          let suggestions: string[] = [];
          let autoIncluded: string[] = [];
          let previouslyEnriched: string[] = [];
          let enrichableContacts = 0;
          try {
            const prev = await client.request<BulkEnrichPreview>(
              "POST",
              "/leads/selection/enrichment/preview",
              { titles: [] }
            );
            suggestions = prev.title_suggestions ?? [];
            autoIncluded = prev.auto_included_titles ?? [];
            previouslyEnriched = prev.previously_enriched_titles ?? [];
            enrichableContacts = prev.enrichable_contacts;
          } catch (e: any) {
            ctx?.logger?.warn?.(
              `enrich_titles: 0-titles preview failed: ${e?.message}`
            );
          }
          return {
            mode: "discover",
            available_titles: availableTitles,
            recommendations: suggestions,
            auto_included: autoIncluded,
            previously_enriched: previouslyEnriched,
            enrichable_contacts: enrichableContacts,
            selected_lead_count: leadIds.length,
            next_action:
              "Pick titles to enrich and call leadbay_enrich_titles again with titles=[...]",
          };
        }

        // Branch B — preview then launch.
        let preview: BulkEnrichPreview;
        try {
          preview = await client.request<BulkEnrichPreview>(
            "POST",
            "/leads/selection/enrichment/preview",
            { titles: params.titles }
          );
        } catch (err: any) {
          if (err?.code === "QUOTA_EXCEEDED") {
            return {
              status: "quota_exceeded",
              message: "Quota exceeded on preview",
              retry_after_seconds: err?._meta?.retry_after ?? null,
            };
          }
          throw err;
        }

        if (preview.enrichable_contacts === 0) {
          return {
            mode: "preview_only",
            preview,
            launched: false,
            message:
              "No enrichable contacts for the chosen titles. Try other titles from available_titles or recommendations.",
            available_titles: availableTitles,
          };
        }

        if (params.dry_run) {
          return {
            mode: "dry_run",
            preview,
            launched: false,
            would_launch: { titles: params.titles, email, phone },
          };
        }

        try {
          await client.requestVoid(
            "POST",
            "/leads/selection/enrichment/launch",
            { titles: params.titles, email, phone }
          );
        } catch (err: any) {
          if (err?.code === "QUOTA_EXCEEDED") {
            return {
              status: "quota_exceeded",
              preview,
              message: "Quota exceeded on launch",
              retry_after_seconds: err?._meta?.retry_after ?? null,
            };
          }
          throw err;
        }

        return {
          mode: "launched",
          preview,
          launched: true,
          titles: params.titles,
          email,
          phone,
          message:
            "Enrichment job launched. The Leadbay backend does not return a bulk_id (probed 2026-04-20) — " +
            "track results by polling individual leads via leadbay_get_contacts after ~60s; contact.enrichment.done flips to true.",
          next_action:
            "Wait ~60s, then call leadbay_research_lead or leadbay_get_contacts on the leads you care about.",
        };
      } finally {
        // Always clear, but never re-throw from finally (would mask the
        // original error if there was one).
        try {
          await client.requestVoid("POST", "/leads/selection/clear");
        } catch (e: any) {
          ctx?.logger?.warn?.(
            `enrich_titles: selection.clear failed: ${e?.message ?? e?.code}`
          );
        }
      }
    } finally {
      client.releaseSelectionLock();
    }
  },
};
