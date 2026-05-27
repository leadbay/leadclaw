import type { ScenarioFixture } from "../daily-check-in/clean-batch.scenario.js";

const P = (path: string) => `/1.5${path}`;

export const SCENARIO: ScenarioFixture<{ lead_id: string; summary: string }> = {
  name: "user-confirmed",
  prompt: "leadbay_log_outreach",
  tier: "gate",
  args: {
    lead_id: "lead_acme_001",
    summary: "Phoned Jamie at Acme Health, walked through Leadbay value-prop, agreed to a follow-up next week.",
  },
  backendFixtures: [
    // ── report_outreach: POST /leads/{leadId}/notes ───────────────────────
    {
      method: "POST",
      path: P(`/leads/lead_acme_001/notes`),
      status: 200,
      body: {
        id: "note_001",
        lead_id: "lead_acme_001",
        note: "Phoned Jamie at Acme Health, walked through Leadbay value-prop, agreed to a follow-up next week.",
        created_at: "2026-05-15T15:00:00Z",
      },
    },
    // ── report_outreach: POST /leads/epilogue ─────────────────────────────
    {
      method: "POST",
      path: P(`/leads/epilogue`),
      status: 204,
      body: null,
    },
  ],
  workflow_id: 9,
};
