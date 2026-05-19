import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";

interface MonitorResponse {
  items?: unknown[];
  leads?: unknown[];
  pagination?: { page: number; pages: number; total: number };
}
import { leadbay_pull_liked_leads as PULL_LIKED_LEADS_DESCRIPTION } from "../tool-descriptions.generated.js";

function normalizeLinkedinPage(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return null;
  return trimmed;
}

function augmentContact(c: any) {
  return c ? { ...c, linkedin_page: normalizeLinkedinPage(c.linkedin_page ?? null) } : null;
}

interface PullLikedLeadsParams {
  count?: number;
  page?: number;
  personal?: boolean;
}

export const pullLikedLeads: Tool<PullLikedLeadsParams> = {
  name: "leadbay_pull_liked_leads",
  annotations: {
    title: "Pull liked leads (cross-lens)",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: PULL_LIKED_LEADS_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      count: { type: "number", description: "Leads per page, max 50 (default 20)" },
      page: { type: "number", description: "Page number, 0-indexed (default 0)" },
      personal: {
        type: "boolean",
        description: "When true, restrict to leads liked by the current user only. Default false (org-wide).",
      },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      leads: { type: "array", description: "Liked leads across all lenses.", items: { type: "object" } },
      pagination: { type: "object", description: "page, pages, total." },
      has_more: { type: "boolean" },
      next_page: { type: ["number", "null"] },
      _meta: { type: "object" },
    },
    required: ["leads", "pagination"],
  },
  execute: async (client: LeadbayClient, params: PullLikedLeadsParams) => {
    const count = Math.min(params.count ?? 20, 50);
    const page = params.page ?? 0;
    const personal = params.personal ?? false;

    const qs = new URLSearchParams({
      liked: "true",
      personal: String(personal),
      filtered: "false",
      count: String(count),
      page: String(page),
    }).toString();

    const monitor = await client.request<MonitorResponse>("GET", `/monitor?${qs}`);

    const rawLeads: any[] = Array.isArray(monitor.items)
      ? monitor.items
      : Array.isArray((monitor as any).leads)
        ? (monitor as any).leads
        : Array.isArray(monitor)
          ? (monitor as unknown as any[])
          : [];

    const leads = rawLeads.map((lead) => ({
      ...lead,
      recommended_contact: augmentContact(lead.recommended_contact),
      org_contacts: Array.isArray(lead.org_contacts)
        ? lead.org_contacts.map(augmentContact)
        : lead.org_contacts ?? null,
    }));

    const pagination = (monitor as any).pagination ?? null;
    const totalPages = pagination?.pages ?? 0;
    const hasMore = page < totalPages - 1;

    return {
      leads,
      pagination,
      has_more: hasMore,
      next_page: hasMore ? page + 1 : null,
      _meta: {
        region: client.region,
        latency_ms: client.lastMeta?.latency_ms ?? null,
      },
    };
  },
};
