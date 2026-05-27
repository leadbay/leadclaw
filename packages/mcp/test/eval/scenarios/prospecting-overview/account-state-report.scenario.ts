/**
 * Prospecting overview scenario: user asks where they stand.
 *
 * The user has an active lens with moderate quota. Expected agent behavior:
 *   1. Call leadbay_account_status
 *   2. Summarize the account state (quota, lens, pending actions)
 *   3. Propose a NEXT STEP (not execute it)
 *   4. NOT call leadbay_report_outreach or any mutating tool
 *
 * Fixture paths match the actual LeadbayClient API calls:
 *   - account_status: GET /users/me + GET /organizations/{orgId}/quota_status
 */
import type { ScenarioFixture } from "../daily-check-in/clean-batch.scenario.js";

const ORG_ID = "org_ov_001";
const LENS_ID = 22;
const P = (path: string) => `/1.5${path}`;

export const SCENARIO: ScenarioFixture<Record<string, never>> = {
  name: "account-state-report",
  prompt: "leadbay_prospecting_overview",
  tier: "gate",
  args: {},
  backendFixtures: [
    {
      method: "GET",
      path: P("/users/me"),
      status: 200,
      body: {
        id: "user_ov_001",
        email: "demo@leadbay.ai",
        name: "Demo User",
        admin: false,
        manager: false,
        organization: {
          id: ORG_ID,
          name: "Overview Demo Org",
          ai_agent_enabled: true,
          computing_intelligence: false,
        },
        last_requested_lens: LENS_ID,
      },
    },
    {
      method: "GET",
      path: P(`/organizations/${ORG_ID}/quota_status`),
      status: 200,
      body: {
        ai_rescore_remaining: 80,
        web_fetch_remaining: 200,
        monitored_remaining: 12,
      },
    },
  ],
  workflow_id: 7,
};
