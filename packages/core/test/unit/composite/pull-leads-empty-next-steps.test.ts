/**
 * Unit tests for the empty-batch branch of buildPullLeadsNextSteps — the fix
 * for product#3826 ("Pull non-ICP Leads not working").
 *
 * A brand-new lens auto-fills its wishlist asynchronously, so the first pull
 * is often empty while leads stream in (~30–60s). Pre-fix, an empty batch
 * returned next_steps:null and the agent declared the lens broken. The fix:
 * when the batch is empty AND the lens is still computing, hand the agent a
 * "wait & re-pull" next-step instead of silence.
 *
 * The legacy contract — `{leadCount:0}` with NO `computing` flag → null — is
 * locked by the existing pull-leads-next-steps.test.ts and MUST stay green;
 * the `computing` param is optional and falsy by default precisely so that
 * call is unaffected. This file covers only the NEW branch.
 */

import { describe, it, expect } from "vitest";
import { buildPullLeadsNextSteps } from "../../../src/composite/pull-leads.js";

describe("buildPullLeadsNextSteps — empty-batch / fresh-lens branch", () => {
  it("empty AND computing — offers a wait-and-re-pull (not null)", () => {
    const ns = buildPullLeadsNextSteps({
      leadCount: 0,
      hasMore: false,
      nextPage: null,
      computing: true,
    });
    expect(ns).not.toBeNull();
    expect(ns!.options[0].kind).toBe("wait_and_repull");
    expect(ns!.options[0].description).toMatch(/re-?pull|pull again/i);
    // A refine-audience escape hatch rounds it out.
    expect(ns!.options.some((o) => o.kind === "refine_audience")).toBe(true);
  });

  it("empty AND NOT computing — stays null (genuinely exhausted lens)", () => {
    expect(
      buildPullLeadsNextSteps({
        leadCount: 0,
        hasMore: false,
        nextPage: null,
        computing: false,
      })
    ).toBeNull();
  });

  it("empty with no computing flag — stays null (legacy contract preserved)", () => {
    expect(
      buildPullLeadsNextSteps({ leadCount: 0, hasMore: false, nextPage: null })
    ).toBeNull();
  });

  it("computing must NOT hijack a populated batch — artifact offer stays first", () => {
    const ns = buildPullLeadsNextSteps({
      leadCount: 12,
      hasMore: false,
      nextPage: null,
      computing: true,
    });
    expect(ns).not.toBeNull();
    expect(ns!.options[0].kind).toBe("build_artifact");
    expect(ns!.options.some((o) => o.kind === "wait_and_repull")).toBe(false);
  });

  it("empty+computing options obey the widget caps (≤4 options, ≤5-word labels)", () => {
    const ns = buildPullLeadsNextSteps({
      leadCount: 0,
      hasMore: false,
      nextPage: null,
      computing: true,
    });
    expect(ns!.options.length).toBeLessThanOrEqual(4);
    for (const opt of ns!.options) {
      expect(opt.label.trim().split(/\s+/).length).toBeLessThanOrEqual(5);
      expect(opt.description.length).toBeGreaterThan(opt.label.length);
    }
  });
});
