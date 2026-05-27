import type { ScenarioFixture } from "../daily-check-in/clean-batch.scenario.js";

const ORG_ID = "org_rfn_001";
const P = (path: string) => `/1.5${path}`;

export const SCENARIO: ScenarioFixture<{ instruction: string }> = {
  name: "clarification-roundtrip",
  prompt: "leadbay_refine_audience",
  tier: "gate",
  args: { instruction: "focus on hospitals running their own IT" },
  backendFixtures: [
    // ── refine_prompt: GET /users/me (to get orgId) ───────────────────────
    {
      method: "GET",
      path: P("/users/me"),
      status: 200,
      body: {
        id: "user_rfn_001",
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
        last_requested_lens: 99,
      },
    },
    // ── refine_prompt: POST /organizations/{orgId}/user_prompt ────────────
    {
      method: "POST",
      path: P(`/organizations/${ORG_ID}/user_prompt`),
      status: 204,
      body: null,
    },
    // ── refine_prompt: GET /organizations/{orgId}/clarifications (polling) ─
    {
      method: "GET",
      path: P(`/organizations/${ORG_ID}/clarifications`),
      status: 200,
      body: {
        id: "clarif_001",
        question: "By 'their own IT', do you mean self-hosted EMR, in-house infrastructure team, or both?",
        options: ["self-hosted EMR only", "in-house infra team only", "both"],
        created_at: "2026-05-26T09:00:00Z",
      },
    },
  ],
  workflow_id: 6,
};
