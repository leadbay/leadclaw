import { describe, it } from "vitest";
import { describeIfSelected, selectTouchedKeys } from "../helpers/touchfiles.js";
import { runScenarioEval, setupScenarioFixtures } from "../helpers/run-eval.js";
import { SCENARIO } from "../scenarios/refine-audience/clarification-roundtrip.scenario.js";

const mode = describeIfSelected("leadbay_refine_audience", selectTouchedKeys());

describe.skipIf(mode === "skip")("eval: leadbay_refine_audience", () => {
  setupScenarioFixtures(SCENARIO);
  it(`${SCENARIO.name} scenario passes pyramid + invariants + mission-match`, async () => {
    await runScenarioEval({ scenario: SCENARIO, max_turns: 10 });
  });
});
