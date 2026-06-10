# Eval scenarios — `leadbay_scan_portfolio_signals`

Two scenarios guarding the issue #3704 fix. Both are authored to the scenario
shape in `../../README.md` (§"Adding a scenario") and are fixture-complete —
they run as soon as the scenario-execution glue (`helpers/run-eval.ts`,
`setupScenarioFixtures`, `runScenarioEval`, `vitest.eval.config.ts`) lands. That
glue does not exist on this branch yet, so there is intentionally **no
`prompts/*.eval.ts` wiring file** — adding one would import a module that
doesn't exist and break the build. Wire them up like this once the runner is in:

```ts
// prompts/leadbay_followup_check_in.eval.ts
import { runScenarioEval, setupScenarioFixtures } from "../helpers/run-eval.js";
import { SCENARIO as FINDS_MA } from "../scenarios/scan-portfolio-signals/finds-ma-cohort.scenario.js";
import { SCENARIO as HONEST } from "../scenarios/scan-portfolio-signals/honest-about-unresearched.scenario.js";

for (const s of [FINDS_MA, HONEST]) {
  describe(`eval: ${s.prompt} — ${s.name}`, () => {
    setupScenarioFixtures(s);
    it(s.name, async () => { await runScenarioEval({ scenario: s }); });
  });
}
```

| Scenario | Failure mode it catches |
|---|---|
| `finds-ma-cohort` | **Underdeliver.** Portfolio has post-2025 M&A signals; the agent must answer via ONE `leadbay_scan_portfolio_signals` call and surface the matched cohort — not loop `leadbay_research_lead_by_id` per lead and not give up (JM's original failure). |
| `honest-about-unresearched` | **Fabrication / `stale_at` confusion.** Some leads have no cached signals; the agent must report them as *not yet researched* (the scan's `not_researched` bucket), never as "no M&A signal", and must not fabricate a verdict (milstan's diagnosis). `no_fabrication` must score 5. |

Both were validated against the live US test account (`SnapLock Industries`)
during development: `leadbay_scan_portfolio_signals` correctly returned real
M&A matches (e.g. "QUEST DRAPE, LLC — acquired Drape Kings in March 2025",
hot, sourced, dated) across a 60-lead scan in ~2.3s with zero per-lead
research loops.
