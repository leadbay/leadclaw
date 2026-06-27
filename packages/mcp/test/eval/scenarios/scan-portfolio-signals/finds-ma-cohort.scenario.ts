// Eval scenario — UNDERDELIVER guard for issue #3704.
//
// JM built a 497-lead portfolio and asked "which of these acquired a company
// since 2025". The agent had no bulk path, looped research_lead_by_id ~60
// times, then gave up. This scenario asserts the FIX: when the portfolio has
// matching M&A signals, the agent must reach for leadbay_scan_portfolio_signals
// (ONE call) and surface the matched cohort — NOT loop research_lead_by_id per
// lead and NOT abandon the task.
//
// Authored to the README scenario shape (test/eval/README.md). Runs once the
// scenario-execution glue (run-eval.ts / setupScenarioFixtures) lands; the
// fixtures + mission are runner-ready today.

const P = (path: string) => `/1.6${path}`; // LeadbayClient prepends /1.6

// A small Monitor portfolio: two leads with a clear post-2025 M&A signal, one
// without. The agent should scan all three and return exactly the two matches.
const MONITOR_LEADS = [
  {
    id: "lead-ma-1",
    name: "QUEST DRAPE, LLC",
    score: 78,
    location: { city: "Frisco", state: "Texas", country: "US", full: "Frisco, Texas, United States" },
    recommended_contact: null,
    org_contacts: [],
    pushback_status: null,
  },
  {
    id: "lead-ma-2",
    name: "ACME EVENTS GROUP",
    score: 71,
    location: { city: "Austin", state: "Texas", country: "US", full: "Austin, Texas, United States" },
    recommended_contact: null,
    org_contacts: [],
    pushback_status: null,
  },
  {
    id: "lead-nomatch-3",
    name: "STILLWATER RENTALS INC.",
    score: 64,
    location: { city: "Tulsa", state: "Oklahoma", country: "US", full: "Tulsa, Oklahoma, United States" },
    recommended_contact: null,
    org_contacts: [],
    pushback_status: null,
  },
];

const wf = (leadId, content) => ({
  method: "GET",
  path: P(`/leads/${leadId}/web_fetch`),
  status: 200,
  body: { lead_id: leadId, in_progress: false, fetch_at: "2025-06-01T00:00:00Z", content },
});

export const SCENARIO = {
  name: "scan-finds-ma-cohort",
  prompt: "leadbay_followup_check_in",
  tier: "gate",
  args: {},
  backendFixtures: [
    // Monitor filter read + portfolio page (followup_check_in pulls Monitor first).
    { method: "GET", path: P("/monitor/filter"), status: 200, body: { criteria: [] } },
    {
      method: "GET",
      path: /\/1\.6\/monitor\?/,
      status: 200,
      body: { items: MONITOR_LEADS, pagination: { page: 0, pages: 1, total: 3 } },
    },
    // Cached signals per lead — the scan reads these (GET only, no POST).
    wf("lead-ma-1", {
      "📈 business signals": [
        { description: "Acquired Drape Kings in March 2025 to extend product offerings.", source: "Dealroom", date: "2025-03-01", hot: true },
      ],
    }),
    wf("lead-ma-2", {
      "📈 business signals": [
        { description: "Closed acquisition of a regional competitor in Q1 2025.", source: "PR Newswire", date: "2025-02-12", hot: true },
      ],
    }),
    wf("lead-nomatch-3", {
      "📈 business signals": [
        { description: "Opened a second warehouse; hiring seasonal staff.", source: "company blog", date: "2025-04-20" },
      ],
    }),
  ],
  mission: {
    user_intent:
      "Find every lead in my Monitor portfolio that acquired a company since 2025, so I can build a campaign.",
    success_criteria: [
      "called leadbay_scan_portfolio_signals exactly once to answer the portfolio-wide signal question",
      "surfaced QUEST DRAPE, LLC and ACME EVENTS GROUP as the M&A matches with their signal text",
      "did NOT loop leadbay_research_lead_by_id per lead to answer the bulk question",
      "did NOT claim a lead has or lacks an M&A signal without it appearing in the scan results",
      "offered to build a campaign from the matched cohort",
    ],
    required_calls: ["leadbay_scan_portfolio_signals"],
    required_byproducts: [],
    forbidden_calls: ["leadbay_report_outreach"],
  },
};
