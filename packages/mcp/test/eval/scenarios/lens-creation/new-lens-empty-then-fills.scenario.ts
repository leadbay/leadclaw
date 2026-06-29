// Eval scenario — UNDERDELIVER guard for product#3826
// ("Pull non-ICP Leads not working").
//
// A user asked for a custom non-ICP audience (potential MCP users — GTM /
// sales-ops / data / AI people at tech companies). The agent created a new
// lens, then pull_leads returned EMPTY because a brand-new lens fills its
// wishlist asynchronously (~30–60s). The agent retried, tried the extend
// flow, then gave up and hallucinated causes (plan:null, SIRENE codes).
//
// This locks the FIX: an empty pull on a still-computing fresh lens must NOT
// be treated as failure. pull_leads now returns a wait_and_repull next-step
// (buildPullLeadsNextSteps, empty+computing branch) and the tool-description
// framing tells the agent a fresh lens fills asynchronously — re-pull in ~30s.
//
// Authored to the README scenario shape (test/eval/README.md) and modeled on
// new-lens-string-base.scenario.ts. Fixture-complete; runs once the
// scenario-execution glue lands on the branch. The deterministic red/green
// proof of the empty+computing branch lives in the unit mirror
// packages/core/test/unit/composite/pull-leads-empty-next-steps.test.ts.

const P = (path: string) => `/1.6${path}`; // LeadbayClient prepends /1.6

const ME = {
  id: "u-1",
  email: "u@example.com",
  organization: { id: "org-1", name: "Acme" },
  language: "en",
  last_requested_lens: 39107,
};

const SECTORS = [
  { id: "1", name: "Software" },
  { id: "2", name: null }, // dirty row — must not crash the scan
  { id: "3", name: "Fintech" },
];

// The populated batch the lens yields once its wishlist has filled.
const FILLED_LEADS = [
  {
    id: "lead-1",
    name: "Pennylane",
    score: 82,
    location: { city: "Paris", country: "FR", full: "Paris, France" },
    recommended_contact: null,
  },
  {
    id: "lead-2",
    name: "Qonto",
    score: 77,
    location: { city: "Paris", country: "FR", full: "Paris, France" },
    recommended_contact: null,
  },
];

export const SCENARIO = {
  name: "new-lens-empty-then-fills",
  // leadbay_new_lens is a TOOL, not a prompt; the intent enters through the
  // orientation prompt and is driven by mission.user_intent.
  prompt: "leadbay_prospecting_overview",
  tier: "gate",
  args: {},
  backendFixtures: [
    // resolveSectors → resolveMe (lang) + /sectors/all
    { method: "GET", path: P("/users/me"), status: 200, body: ME },
    {
      method: "GET",
      path: P("/sectors/all?lang=en&includeInvisible=false"),
      status: 200,
      body: SECTORS,
    },
    // create the lens (base must be a STRING server-side)
    {
      method: "POST",
      path: P("/lenses"),
      status: 200,
      body: { id: 777, name: "MCP Users", user_id: "u-1" },
    },
    // apply the sector filter
    { method: "POST", path: P("/lenses/777/filter"), status: 200, body: {} },
    // FIRST pull — wishlist still building: EMPTY + computing flags true.
    // The agent must NOT declare failure here; it should re-pull.
    {
      method: "GET",
      path: /\/1\.6\/lenses\/777\/leads\/wishlist\?/,
      status: 200,
      body: {
        items: [],
        pagination: { page: 0, pages: 0, total: 0 },
        computing_wishlist: true,
        computing_scores: true,
      },
    },
  ],
  mission: {
    user_intent:
      "Create a lens for potential MCP users — GTM / sales-ops / data / AI people at tech companies — and show me leads from it.",
    success_criteria: [
      "created the lens via leadbay_new_lens (confirm:true) for the custom audience",
      "on the EMPTY pull_leads result, recognized the lens is still filling (computing_wishlist/computing_scores) and surfaced a wait-and-re-pull next-step OR told the user leads stream in over ~30–60s and to retry",
      "did NOT declare the lens / pull broken, and did NOT invent a non-existent fill tool",
      "did NOT hallucinate a cause such as plan:null or missing SIRENE sector codes for the empty result",
    ],
    required_calls: ["leadbay_new_lens", "leadbay_pull_leads"],
    required_byproducts: [],
    forbidden_calls: ["leadbay_report_outreach"],
  },
};
