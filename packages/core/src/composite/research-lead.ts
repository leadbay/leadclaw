import type { LeadbayClient } from "../client.js";
import type {
  Tool,
  ToolContext,
  AiAgentResponse,
  LeadPayload,
  LeadWebFetchPayload,
  WebFetchSignalsSection,
  PaidContactPayload,
  ContactPayload,
  NotePayload,
  EpilogueResponsesPayload,
  ProspectingActionsPayload,
} from "../types.js";

interface ResearchLeadParams {
  leadId: string;
  lensId?: number;
  concise?: boolean;
}

// Map an emoji-prefixed section label like "🏢 company profile" to
// {section_emoji: "🏢", section_label: "company profile"}. If no emoji, label
// stays as-is. Stable section ordering: profile → signals → clues → others.
const SECTION_PRIORITY = ["profile", "signals", "clues"];

function splitEmojiSection(key: string): { emoji: string | null; label: string } {
  // Match a leading non-letter/non-digit character (typically emoji) followed by space.
  const m = key.match(/^([^\p{L}\p{N}\s]+)\s+(.+)$/u);
  if (m) return { emoji: m[1], label: m[2] };
  return { emoji: null, label: key };
}

function reshapeWebFetchContent(
  content: Record<string, unknown> | null
): WebFetchSignalsSection[] {
  if (!content) return [];
  const sections: WebFetchSignalsSection[] = [];
  for (const [key, val] of Object.entries(content)) {
    if (!Array.isArray(val)) continue;
    const { emoji, label } = splitEmojiSection(key);
    sections.push({
      section_label: label,
      section_emoji: emoji,
      entries: val as WebFetchSignalsSection["entries"],
    });
  }
  // Sort: known section labels first (in priority order), then alphabetical.
  sections.sort((a, b) => {
    const ai = SECTION_PRIORITY.findIndex((p) => a.section_label.toLowerCase().includes(p));
    const bi = SECTION_PRIORITY.findIndex((p) => b.section_label.toLowerCase().includes(p));
    const aN = ai < 0 ? SECTION_PRIORITY.length : ai;
    const bN = bi < 0 ? SECTION_PRIORITY.length : bi;
    if (aN !== bN) return aN - bN;
    return a.section_label.localeCompare(b.section_label);
  });
  return sections;
}

export const researchLead: Tool<ResearchLeadParams> = {
  name: "leadbay_research_lead",
  annotations: {
    title: "Research a Leadbay lead in depth",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description:
    "Tell me everything decision-relevant about a single lead. Bundles the lens-scoped lead profile, the AI " +
    "qualification answers (the agent's knowledge-base food), the structured web-research signals (with hot " +
    "flags + sources), the enriched contacts, and the recent notes/epilogue/prospecting activity in one call. " +
    "Order is deliberate: qualification first, then signals, then firmographics, then contacts, then engagement. " +
    "Scoring has two layers: the basic `score` (firmographic, always present, already decent) and the AI " +
    "qualification layer (`ai_agent_lead_score` + per-question answers + web_fetch signals). The AI layer is " +
    "pre-populated for roughly the top 10 of each daily batch, and on-demand (via leadbay_bulk_qualify_leads) " +
    "for anything below that. Combine both layers when judging a lead. " +
    "When to use: when picking up a single lead from leadbay_pull_leads to decide whether to act on it. " +
    "When NOT to use: across many leads at once — that's leadbay_pull_leads' job. " +
    "(This composite supersedes the lower-level leadbay_get_lead_profile in agent flow; the granular tool stays " +
    "available for fine-grained access.)",
  inputSchema: {
    type: "object",
    properties: {
      leadId: { type: "string", description: "Lead UUID (required)" },
      lensId: {
        type: "number",
        description:
          "Lens id (escape hatch — normally omit; auto-resolves to the active lens)",
      },
      concise: {
        type: "boolean",
        description:
          "If true, trim signals to hot=true items only (smaller payload). Default false.",
      },
    },
    required: ["leadId"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      qualification: {
        type: "array",
        description:
          "Per-question AI qualification answers, ordered by mission importance. Each entry: question, boost_score (canonical -10|0|10|20), score_scale, response, computed_at. score_0_to_10 is a deprecated alias of boost_score (removed in 0.7.0).",
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            boost_score: { type: ["number", "null"] },
            score_scale: { type: "string" },
            score_0_to_10: { type: ["number", "null"] },
            response: { type: ["string", "null"] },
            computed_at: { type: ["string", "null"] },
          },
        },
      },
      signals: {
        type: "array",
        description:
          "Web-research signals reshaped into priority-ordered sections (profile → signals → clues → other). Each entry: section_label, section_emoji, entries[]. With concise:true, only hot=true entries kept.",
        items: { type: "object" },
      },
      firmographics: {
        type: "object",
        description: "Lead profile basics: id, name, sector_id, size, location, website, description, short_description.",
      },
      contacts: {
        type: "array",
        description: "Enriched contacts known to this org for this lead.",
        items: { type: "object" },
      },
      org_contacts: {
        type: "array",
        description: "Contacts visible at the org level beyond this lens.",
        items: { type: "object" },
      },
      recent: {
        type: "object",
        description:
          "Recent engagement: notes, epilogue, prospecting_actions. Each is null/missing when no engagement exists. Conditionally fetched (not fanned out unless counts > 0).",
      },
      _meta: {
        type: "object",
        properties: {
          region: { type: "string" },
          latency_ms: { type: ["number", "null"] },
          web_fetch_in_progress: { type: "boolean" },
        },
      },
    },
    required: ["qualification", "signals", "firmographics"],
  },
  execute: async (
    client: LeadbayClient,
    params: ResearchLeadParams,
    ctx?: ToolContext
  ) => {
    const lensId = params.lensId ?? (await client.resolveDefaultLens());
    const leadId = params.leadId;

    // Mark the lead as seen+clicked so Leadbay ages it out of the
    // Discover "new" view and the lens-refresh pipeline can deliver
    // fresh leads on next pull. Fire-and-forget: failure here must NOT
    // break research_lead.
    void client.request<void>("POST", "/interactions", [
      { type: "LEAD_SEEN",    leadId, lensId: String(lensId) },
      { type: "LEAD_CLICKED", leadId, lensId: String(lensId) },
    ]).catch(() => { /* swallow */ });

    // Fan-out the four sub-fetches in parallel. Soft-fail on the additive ones.
    const [profileR, qualR, contactsR, webFetchR] = await Promise.allSettled([
      client.request<LeadPayload>("GET", `/lenses/${lensId}/leads/${leadId}`),
      client.request<AiAgentResponse[]>(
        "GET",
        `/leads/${leadId}/ai_agent_responses`
      ),
      client.request<PaidContactPayload[]>(
        "GET",
        `/leads/${leadId}/enrich/contacts?IncludeEnriched=true`
      ),
      client.request<LeadWebFetchPayload>("GET", `/leads/${leadId}/web_fetch`),
    ]);

    if (profileR.status === "rejected") {
      throw profileR.reason;
    }
    const lead = profileR.value;

    // Notes/epilogue/prospecting — only fetch if the lead summary suggests
    // there's anything to fetch. Saves 3 HTTP calls per lead in the common
    // case where nothing has been logged yet.
    const wantNotes = (lead.notes_count ?? 0) > 0;
    const wantEpilogue = (lead.epilogue_actions_count ?? 0) > 0;
    const wantProspecting = (lead.prospecting_actions_count ?? 0) > 0;
    const wantOrgContacts = (lead.org_contacts_count ?? 0) > 0;

    const engagementFetches = await Promise.allSettled([
      wantNotes
        ? client.request<NotePayload[]>("GET", `/leads/${leadId}/notes`)
        : Promise.resolve(null),
      wantEpilogue
        ? client.request<EpilogueResponsesPayload>(
            "GET",
            `/leads/${leadId}/epilogue_responses?count=10&page=0`
          )
        : Promise.resolve(null),
      wantProspecting
        ? client.request<ProspectingActionsPayload>(
            "GET",
            `/leads/${leadId}/prospecting_actions?count=10&page=0`
          )
        : Promise.resolve(null),
      wantOrgContacts
        ? client.request<ContactPayload[]>(
            "GET",
            `/leads/${leadId}/contacts?IncludeEnriched=true`
          )
        : Promise.resolve(null),
    ]);

    const [notesR, epilogueR, prospR, orgContactsR] = engagementFetches;
    const valOrNull = <T>(r: PromiseSettledResult<T | null>): T | null =>
      r.status === "fulfilled" ? (r.value ?? null) : null;

    let signals = reshapeWebFetchContent(
      webFetchR.status === "fulfilled" ? webFetchR.value?.content ?? null : null
    );
    if (params.concise) {
      signals = signals
        .map((s) => ({
          ...s,
          entries: s.entries.filter((e) => e.hot === true),
        }))
        .filter((s) => s.entries.length > 0);
    }

    const paidContacts =
      contactsR.status === "fulfilled" ? contactsR.value : [];
    const orgContacts = valOrNull(orgContactsR) ?? [];

    return {
      // 1) qualification — single most important block for "is this lead worth pursuing"
      // boost_score is the canonical field (per AiAgentResponse.score). The valid
      // set is the discrete -10/0/10/20 boost (see types.ts comment), NOT a 0-10
      // average — the eval doc flagged the old `score_0_to_10` field name as
      // misleading. We now ship `boost_score` as canonical alongside an explicit
      // `score_scale` annotation; `score_0_to_10` is kept as a deprecated alias
      // for one minor version (0.6.x) and removed in 0.7.0. See MIGRATION.md.
      qualification:
        qualR.status === "fulfilled"
          ? qualR.value.map((r) => ({
              question: r.question,
              boost_score: r.score,
              score_scale: "-10|0|10|20" as const,
              // Deprecated alias — same value as boost_score. Will be removed
              // in 0.7.0; consumers should switch to boost_score.
              score_0_to_10: r.score,
              response: r.response,
              computed_at: r.computed_at,
            }))
          : [],
      // 2) signals — knowledge-base food
      signals,
      // 3) firmographics
      firmographics: {
        id: lead.id,
        name: lead.name,
        sector_id: (lead as any).sector_id ?? null,
        size: lead.size,
        location: lead.location,
        website: lead.website,
        description: lead.description,
        short_description: lead.short_description ?? null,
        keywords: lead.keywords ?? [],
        tags: lead.tags,
        score: lead.score,
        ai_agent_lead_score: lead.ai_agent_lead_score,
        social_presence: lead.social_presence ?? null,
        social_urls: (lead as any).social_urls ?? null,
        registry_ids: (lead as any).registry_ids ?? null,
      },
      // 4) contacts (paid/enriched, plus org contacts if present)
      contacts: {
        enriched: paidContacts.map((c) => ({
          id: c.id,
          first_name: c.first_name,
          last_name: c.last_name,
          job_title: c.job_title,
          email: c.email,
          phone_number: c.phone_number,
          linkedin_page: c.linkedin_page,
          recommended: c.recommended,
          enrichment_done: c.enrichment?.done ?? false,
        })),
        org: orgContacts.map((c) => ({
          id: c.id,
          first_name: c.first_name,
          last_name: c.last_name,
          job_title: c.job_title,
          email: c.email,
        })),
      },
      // 5) engagement — what humans/prior agent runs already did
      engagement: {
        liked: lead.liked,
        disliked: lead.disliked,
        new: lead.new ?? false,
        recommended_contact_title: lead.recommended_contact_title ?? null,
        recommended_contact: lead.recommended_contact ?? null,
        notes_count: lead.notes_count ?? 0,
        epilogue_actions_count: lead.epilogue_actions_count ?? 0,
        prospecting_actions_count: lead.prospecting_actions_count ?? 0,
        recent_notes: valOrNull(notesR)?.slice(0, 3) ?? [],
        recent_epilogue: valOrNull(epilogueR)?.items?.slice(0, 3) ?? [],
        recent_prospecting:
          valOrNull(prospR)?.items?.slice(0, 5) ?? [],
      },
      _meta: {
        region: client.region,
        lens_id: lensId,
        web_fetch_in_progress:
          webFetchR.status === "fulfilled" ? webFetchR.value?.in_progress : false,
      },
    };
  },
};
