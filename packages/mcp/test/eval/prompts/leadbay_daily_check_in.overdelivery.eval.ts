/**
 * Overdelivery guard eval for leadbay_daily_check_in.
 *
 * Asserts the agent stops after surfacing the best lead and never
 * auto-triggers outreach tools (leadbay_report_outreach,
 * leadbay_prepare_outreach) without explicit user confirmation.
 *
 * Runs with EVAL=1 — skipped otherwise.
 */
import { describe, it } from "vitest";
import { runScenarioEval, setupScenarioFixtures } from "../helpers/run-eval.js";
import { describeIfSelected, selectTouchedKeys } from "../helpers/touchfiles.js";
import { SCENARIO } from "../scenarios/daily-check-in/widget-overdelivery-guard.scenario.js";

const selected = selectTouchedKeys();
const mode = describeIfSelected("leadbay_daily_check_in", selected);

describe.skipIf(mode === "skip")("eval: leadbay_daily_check_in — overdelivery guard", () => {
  setupScenarioFixtures(SCENARIO);

  it(`${SCENARIO.name} stops before outreach — no auto-send`, async () => {
    await runScenarioEval({
      scenario: SCENARIO,
      max_turns: 12,
    });
  });
});
