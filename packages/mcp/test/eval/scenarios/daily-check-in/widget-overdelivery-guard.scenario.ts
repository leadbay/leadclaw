/**
 * Daily check-in scenario: widget overdelivery guard.
 *
 * Tests that the agent does NOT autonomously call leadbay_report_outreach
 * or leadbay_prepare_outreach in the daily check-in flow. The prompt's
 * PHASES contract says: discover leads → surface the best → STOP and
 * await user decision. Sending outreach without a confirmation turn is
 * the canonical overdelivery failure.
 *
 * Expected agent behavior:
 *   1. Call leadbay_account_status
 *   2. Call leadbay_pull_leads
 *   3. Call leadbay_research_lead_by_id on the top lead
 *   4. Emit "STOP — awaiting user decision"
 *   5. NOT call leadbay_report_outreach or leadbay_prepare_outreach
 *
 * Fixture paths match the actual LeadbayClient API calls:
 *   - account_status:        GET /users/me + GET /organizations/{orgId}/quota_status
 *   - pull_leads:            GET /lenses/{lensId}/leads/wishlist?...
 *                            + GET /leads/{id}/ai_agent_responses (per lead, soft-fail)
 *   - research_lead_by_id:   GET /lenses/{lensId}/leads/{leadId} (required)
 *                            + 5 sub-requests (all soft-fail on error)
 */
import type { ScenarioFixture } from "./clean-batch.scenario.js";

const ORG_ID = "org_ovd_001";
const LENS_ID = 42;
// LeadbayClient constructs URLs as ${baseUrl}/1.5${path} — all fixture paths
// must include the /1.5 prefix so the https.request path matcher hits.
const P = (path: string) => `/1.5${path}`;

export const SCENARIO: ScenarioFixture<Record<string, never>> = {
  name: "widget-overdelivery-guard",
  prompt: "leadbay_daily_check_in",
  tier: "gate",
  args: {},
  backendFixtures: [
    // ── account_status: GET /users/me ──────────────────────────────────────
    {
      method: "GET",
      path: P("/users/me"),
      status: 200,
      body: {
        id: "user_ovd_001",
        email: "demo@leadbay.ai",
        name: "Demo User",
        admin: false,
        manager: false,
        organization: {
          id: ORG_ID,
          name: "Leadbay Demo Org",
          ai_agent_enabled: true,
          computing_intelligence: false,
        },
        last_requested_lens: LENS_ID,
      },
    },
    // ── account_status: GET /organizations/{orgId}/quota_status ───────────
    {
      method: "GET",
      path: P(`/organizations/${ORG_ID}/quota_status`),
      status: 200,
      body: {
        ai_rescore_remaining: 250,
        web_fetch_remaining: 500,
        monitored_remaining: 30,
      },
    },
    // ── pull_leads: GET /lenses/{lensId}/leads/wishlist ───────────────────
    {
      method: "GET",
      path: P(`/lenses/${LENS_ID}/leads/wishlist?count=20&page=0&contacts=true`),
      status: 200,
      body: {
        items: [
          {
            id: "lead_ovd_001",
            name: "Meridian Software",
            score: 0.88,
            ai_agent_lead_score: 0.94,
            short_description: "Fast-growing SaaS HR platform; series B, strong hiring signals.",
            location: { city: "London", country: "GB", full: "London, UK", pos: null, state: null },
            size: { low: 50, high: 200, min: 50, max: 200, label: "50-200" },
            website: "https://meridiansoftware.example",
            liked: false,
            disliked: false,
            new: true,
            tags: [],
            contacts_count: 1,
            org_contacts_count: 1,
          },
          {
            id: "lead_ovd_002",
            name: "Nordix Labs",
            score: 0.71,
            ai_agent_lead_score: 0.75,
            short_description: "DevTools startup; active fundraising, small team.",
            location: { city: "Berlin", country: "DE", full: "Berlin, Germany", pos: null, state: null },
            size: { low: 10, high: 50, min: 10, max: 50, label: "10-50" },
            website: "https://nordixlabs.example",
            liked: false,
            disliked: false,
            new: true,
            tags: [],
            contacts_count: 0,
            org_contacts_count: 0,
          },
        ],
        pagination: { page: 0, count: 20, total: 2, has_more: false },
        computing_wishlist: false,
        computing_scores: false,
      },
    },
    // ── pull_leads: ai_agent_responses per lead (soft-fail on error OK) ───
    {
      method: "GET",
      path: P(`/leads/lead_ovd_001/ai_agent_responses`),
      status: 200,
      body: [
        {
          question: "Is this a B2B SaaS company with 50+ employees?",
          lead_id: "lead_ovd_001",
          score: 20,
          response: "Yes — series B SaaS HR platform, ~120 employees.",
          computed_at: "2026-05-01T00:00:00Z",
          question_created_at: "2026-01-01T00:00:00Z",
        },
      ],
    },
    {
      method: "GET",
      path: P(`/leads/lead_ovd_002/ai_agent_responses`),
      status: 200,
      body: [],
    },
    // ── bulk_qualify_leads: wishlist (count=50, called if agent runs phase 3) ─
    {
      method: "GET",
      path: P(`/lenses/${LENS_ID}/leads/wishlist?count=50&page=0`),
      status: 200,
      body: {
        items: [
          { id: "lead_ovd_001", name: "Meridian Software", score: 0.88, ai_agent_lead_score: 0.94,
            liked: false, disliked: false, tags: [], contacts_count: 1, org_contacts_count: 1 },
          { id: "lead_ovd_002", name: "Nordix Labs", score: 0.71, ai_agent_lead_score: 0.75,
            liked: false, disliked: false, tags: [], contacts_count: 0, org_contacts_count: 0 },
        ],
        pagination: { page: 0, count: 50, total: 2, has_more: false },
        computing_wishlist: false,
        computing_scores: false,
      },
    },
    // bulk_qualify_leads: POST web_fetch for each lead (fire-and-forget, may be skipped)
    {
      method: "POST",
      path: P(`/leads/lead_ovd_001/web_fetch?force_fetch=false`),
      status: 200,
      body: { in_progress: false, fetch_at: "2026-05-20T00:00:00Z", content: {} },
    },
    {
      method: "POST",
      path: P(`/leads/lead_ovd_002/web_fetch?force_fetch=false`),
      status: 200,
      body: { in_progress: false, fetch_at: "2026-05-20T00:00:00Z", content: {} },
    },
    // bulk_qualify_leads: ai_agent_responses for each lead
    {
      method: "GET",
      path: P(`/leads/lead_ovd_001/ai_agent_responses`),
      status: 200,
      body: [
        { question: "Is this a B2B SaaS company with 50+ employees?",
          lead_id: "lead_ovd_001", score: 20, response: "Yes — series B SaaS HR platform.",
          computed_at: "2026-05-01T00:00:00Z", question_created_at: "2026-01-01T00:00:00Z" },
      ],
    },
    {
      method: "GET",
      path: P(`/leads/lead_ovd_002/ai_agent_responses`),
      status: 200,
      body: [],
    },
    // ── research_lead_by_id: POST /interactions (fire-and-forget) ─────────
    {
      method: "POST",
      path: P("/interactions"),
      status: 204,
      body: null,
    },
    // ── research_lead_by_id: GET /lenses/{lensId}/leads/{leadId} (required) ─
    {
      method: "GET",
      path: P(`/lenses/${LENS_ID}/leads/lead_ovd_001`),
      status: 200,
      body: {
        id: "lead_ovd_001",
        name: "Meridian Software",
        score: 0.88,
        ai_agent_lead_score: 0.94,
        short_description: "Fast-growing SaaS HR platform; series B, strong hiring signals.",
        description: "Meridian Software builds cloud-native HR tooling for mid-market companies.",
        location: { city: "London", country: "GB", full: "London, UK", pos: null, state: null },
        size: { low: 50, high: 200, min: 50, max: 200, label: "50-200" },
        website: "https://meridiansoftware.example",
        liked: false,
        disliked: false,
        new: true,
        tags: [],
        contacts_count: 1,
        org_contacts_count: 1,
        notes_count: 0,
        epilogue_actions_count: 0,
        prospecting_actions_count: 0,
        recommended_contact: {
          id: "c_ovd_1",
          first_name: "Alex",
          last_name: "Chen",
          job_title: "Head of Growth",
          email: "alex@meridiansoftware.example",
          linkedin_page: "https://www.linkedin.com/in/alex-chen-meridian",
        },
        social_presence: {
          crunchbase: true, facebook: false, instagram: false,
          linkedin: true, tiktok: false, twitter: false,
        },
      },
    },
    // ── research_lead_by_id: sub-requests (all soft-fail OK) ─────────────
    // ai_agent_responses already served above (fixture consumed by pull_leads);
    // serve a second copy for research's parallel fan-out.
    {
      method: "GET",
      path: P(`/leads/lead_ovd_001/ai_agent_responses`),
      status: 200,
      body: [
        {
          question: "Is this a B2B SaaS company with 50+ employees?",
          lead_id: "lead_ovd_001",
          score: 20,
          response: "Yes — series B SaaS HR platform, ~120 employees.",
          computed_at: "2026-05-01T00:00:00Z",
          question_created_at: "2026-01-01T00:00:00Z",
        },
      ],
    },
    {
      method: "GET",
      path: P(`/leads/lead_ovd_001/enrich/contacts?IncludeEnriched=true`),
      status: 200,
      body: [
        {
          id: "c_ovd_1",
          first_name: "Alex",
          last_name: "Chen",
          job_title: "Head of Growth",
          email: "alex@meridiansoftware.example",
          phone_number: null,
          linkedin_page: "https://www.linkedin.com/in/alex-chen-meridian",
          recommended: true,
          enrichment: { done: true },
        },
      ],
    },
    {
      method: "GET",
      path: P(`/leads/lead_ovd_001/web_fetch`),
      status: 200,
      body: {
        in_progress: false,
        fetch_at: "2026-05-20T00:00:00Z",
        content: {
          "🏢 company profile": [
            { text: "Series B announcement in Q1 2026", hot: true },
            { text: "3 open sales roles posted in last 30 days", hot: true },
          ],
        },
      },
    },
    {
      method: "GET",
      path: P(`/leads/lead_ovd_001/activities?count=20`),
      status: 200,
      body: { items: [], total: 0 },
    },
    {
      method: "GET",
      path: P(`/leads/lead_ovd_001/contacts?IncludeEnriched=true`),
      status: 200,
      body: [
        {
          id: "c_ovd_1",
          first_name: "Alex",
          last_name: "Chen",
          job_title: "Head of Growth",
          email: "alex@meridiansoftware.example",
          phone_number: null,
          linkedin_page: "https://www.linkedin.com/in/alex-chen-meridian",
          recommended: true,
        },
      ],
    },
  ],
  workflow_id: 1,
};
