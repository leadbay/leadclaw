// Eval scenario — REGRESSION guard for the sector-creation crash class
// (telemetry 30d ending 2026-06-12: adjust_audience 61% fail, 19 TypeError).
//
// Locks the v0.17.3 fix in packages/core/src/composite/adjust-audience.ts:
// the tokens() helper null-guards its input (`if (!s) return []`,
// adjust-audience.ts:35). Before the fix, a single {id, name: null} row in
// the sector taxonomy threw "Cannot read properties of undefined (reading
// 'toLowerCase')" while scanning — killing the WHOLE call regardless of
// what the user actually asked for.
//
// Multi-sector dirty-taxonomy intent: "create a group for menuisiers,
// pergolas, vérandas". The taxonomy contains a null-name row plus only
// partial matches, so the graceful outcome is an ambiguous_sectors message
// — a TypeError / unhandled throw is the bug.
//
// Authored to the README scenario shape (test/eval/README.md). Fixture-
// complete; runs once the scenario-execution glue lands — no prompts/*.eval.ts
// wiring on this branch yet. The deterministic red/green proof of these exact
// fixtures lives in
// packages/core/test/unit/composite/adjust-audience-dirty-taxonomy-regression.test.ts.

const P = (path: string) => `/1.5${path}`; // LeadbayClient prepends /1.5

const ME = {
  id: "u-1",
  email: "u@example.com",
  organization: { id: "org-1", name: "Acme" },
  admin: false,
  last_requested_lens: 4242,
  language: "fr",
};

// Dirty taxonomy: a null-name row (the row that caused the crash) plus only
// partial / weak matches for the requested sectors — nothing resolves
// confidently, so the tool should surface an ambiguous/no-match message
// rather than throw.
const SECTORS = [
  { id: "1", name: "Pergola aluminium" }, // ties with id 3 on "pergola"
  { id: "2", name: null }, // dirty row — used to crash the taxonomy scan
  { id: "3", name: "Pergola bioclimatique" }, // ties with id 1 on "pergola"
  { id: "4", name: "Menuiserie" }, // partial, weak — no confident "menuisiers" match
];

export const SCENARIO = {
  name: "adjust-audience-dirty-taxonomy",
  prompt: "leadbay_adjust_audience",
  tier: "gate",
  args: {},
  backendFixtures: [
    { method: "GET", path: P("/users/me"), status: 200, body: ME },
    {
      method: "GET",
      path: P("/sectors/all?lang=fr&includeInvisible=false"),
      status: 200,
      body: SECTORS,
    },
    // No lens-write fixtures: with no confident sector resolution the tool
    // must bail with an ambiguous_sectors message BEFORE any POST. If it
    // tried to write, the harness would throw on the undeclared endpoint.
  ],
  mission: {
    user_intent:
      "Create a group for menuisiers, pergolas, vérandas — tighten my audience to those trades.",
    success_criteria: [
      "did NOT crash with a TypeError while scanning the sector taxonomy (a null-name taxonomy row must be tolerated)",
      "returned a graceful ambiguous_sectors / couldn't-confidently-resolve message naming the unresolved sector text",
      "did NOT write a half-built lens when the sectors could not be resolved",
    ],
    required_calls: ["leadbay_adjust_audience"],
    required_byproducts: [],
    forbidden_calls: ["leadbay_report_outreach"],
  },
};
