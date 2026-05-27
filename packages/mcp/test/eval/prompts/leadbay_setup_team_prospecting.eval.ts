/**
 * Eval suite for leadbay_setup_team_prospecting (WORKFLOWS.md #11).
 *
 * Tests the manager-led flow: create/activate a lens, validate it produces
 * leads, persist named per-rep campaigns, and add leads to them.
 */
import { describe, it } from "vitest";
import { describeIfSelected, selectTouchedKeys } from "../helpers/touchfiles.js";
import { runScenarioEval, setupScenarioFixtures } from "../helpers/run-eval.js";
import { SCENARIO } from "../scenarios/setup-team-prospecting/create-lens-and-campaign.scenario.js";

const mode = describeIfSelected("leadbay_setup_team_prospecting", selectTouchedKeys());

describe.skipIf(mode === "skip")("eval: leadbay_setup_team_prospecting", () => {
  setupScenarioFixtures(SCENARIO);
  it(`${SCENARIO.name} passes pyramid + invariants + mission-match`, async () => {
    await runScenarioEval({
      scenario: SCENARIO,
      max_turns: 15,
    });
  });
});
