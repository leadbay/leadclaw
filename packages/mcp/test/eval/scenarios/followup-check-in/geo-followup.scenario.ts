/**
 * Geo follow-up — user says "I'm going to Lyon next week — leads to
 * follow up with there". Expected: the agent passes `city: "Lyon"` (or a
 * resolved `city_id`) to `leadbay_pull_followups`. The composite calls
 * `/1.5/geo/search?q=Lyon` internally; if the match is ambiguous it
 * returns `status: "ambiguous_locations"` and the agent picks a
 * candidate before re-calling.
 *
 * What's NOT acceptable: fabricating an admin_area_id, asking the user
 * to set the filter in the app UI (that workaround is dead now that the
 * resolver ships), or calling pull_leads.
 */
import type { ScenarioFixture } from "../daily-check-in/clean-batch.scenario.js";

export const SCENARIO: ScenarioFixture<Record<string, never>> = {
  name: "geo-followup",
  prompt: "leadbay_followup_check_in",
  tier: "gate",
  args: {},
  backendFixtures: [
    {
      method: "GET",
      path: /\/1\.5\/monitor/,
      status: 200,
      body: {
        leads: [
          {
            lead_id: "g1",
            name: "Lyon Hospital A",
            website: "lyonhospital-a.example",
            score: 0.75,
            location: { city: "Lyon", state: "FR" },
            size: { min: 200, max: 500 },
            split_ai_summary: {
              worth_pursuing: "Yes — strong regional fit",
              approach_angle: "Reference the regional health-tech grant they applied for",
              next_step: "Meet in person next week",
            },
            last_monitor_action_at: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(),
            last_prospecting_action: "LEAD_EMAIL_SENT",
            last_prospecting_action_at: new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString(),
            epilogue_status: "EPILOGUE_STILL_CHASING",
            recommended_contact: {
              contact_id: "g1c1",
              first_name: "Marie",
              last_name: "Dubois",
              job_title: "DSI",
              email: "marie@lyonhospital-a.example",
              phone_number: null,
              linkedin_page: "https://www.linkedin.com/in/marie-dubois",
            },
          },
          {
            lead_id: "g2",
            name: "Out-of-region Clinic",
            website: "elsewhere.example",
            score: 0.6,
            location: { city: "Paris", state: "FR" },
            size: { min: 50, max: 200 },
            split_ai_summary: {
              worth_pursuing: "No — not in Lyon",
              approach_angle: "Skip",
              next_step: "Skip — out of scope for this trip",
            },
            last_monitor_action_at: new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString(),
            last_prospecting_action: null,
            last_prospecting_action_at: null,
            epilogue_status: null,
            recommended_contact: null,
          },
        ],
        active_filters: { criteria: [] },
        total_excluded_by_pushback: 0,
        has_more: false,
      },
    },
  ],
  mission: {
    prompt_name: "leadbay_followup_check_in",
    scenario_name: "geo-followup",
    user_intent:
      "Surface follow-up leads in Lyon for next week's trip. The agent should use the city shortcut on leadbay_pull_followups — either `city: \"Lyon\"` (composite resolves via /geo/search) or a pre-resolved `city_id`. Never fabricate an admin_area_id, and don't punt to 'set the filter in the app UI' (that workaround is obsolete).",
    success_criteria: [
      "called leadbay_pull_followups at least once",
      "did NOT call leadbay_pull_leads",
      "passed a `city` (free-text) or `city_id` (resolved numeric id) param to leadbay_pull_followups, OR built a set_filter.criteria with `location_ids` populated from a prior leadbay_list_locations call — never fabricated an admin_area_id",
      "rendered the result using the canonical pull_followups table layout (status emoji + AI take + history + contacts)",
    ],
    required_calls: ["leadbay_pull_followups"],
    required_byproducts: [],
    forbidden_calls: ["leadbay_pull_leads", "leadbay_report_outreach"],
  },
};
