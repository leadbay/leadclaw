# Relentless Eval Loop — Design Spec

**Date:** 2026-05-28  
**Status:** Draft — awaiting user approval

---

## What we're building

An autonomous self-improvement loop where `/relentless` drives `/eval` as its test harness. When an eval scenario fails because the MCP agent behaves wrong, relentless diagnoses the failure from the structured JSON evidence, edits the prompt or tool-description templates, rebuilds, and re-evals — looping until the scenario passes without regressing the known-good workflows.

The loop runs inside a single Claude Code session. `/relentless` is the outer controller; `/eval` is invoked as a skill (not a subprocess) so context stays coherent.

---

## The target failure

**Workflow 2b — routing violation: wrong entry point for follow-up queries**

The agent is given a phrasing that sounds like it could go either way — discovery or follow-up — and should call `leadbay_pull_followups` but currently calls `leadbay_pull_leads` instead.

**Scenario prompt:** `"Show me my pipeline — who haven't I been in touch with lately?"`

This phrasing is ambiguous enough to trip routing without an explicit "follow up" keyword. The contract forbids `leadbay_pull_leads` and requires `leadbay_pull_followups`. The agent's current behavior on this phrasing is the thing we're fixing.

**Why this is a good target:**
- The failure mode is already documented in the template's `failure_modes:` frontmatter (calling pull_leads instead of pull_followups was a real bug in 0.9.0)
- The fix is localized: routing anti-triggers in `leadbay_followup_check_in.md.tmpl` and/or the `pull_leads` tool-description anti-triggers
- The eval signal is binary and unambiguous — either pull_followups was called or it wasn't
- No new tools or backend needed

---

## Architecture

```
/relentless (session context — outer loop)
  │
  ├─ Phase 2: write mission + ≥12 criteria + eval framework
  │     mission: fix workflow 2b routing failure without regressing 1/3/5
  │     criteria: derived from eval JSON fields (passed, judge_scores, per_criterion)
  │
  ├─ Phase 3: plan
  │     edit surface: packages/promptforge/prompts/leadbay_followup_check_in.md.tmpl
  │     secondary:   packages/promptforge/tool-descriptions/composite/pull-leads.md.tmpl
  │                  (anti-triggers that route "pipeline" queries away from pull_leads)
  │     rebuild:     pnpm prompts:build (must exit 0 before re-eval)
  │
  └─ Phase 4 iteration loop:
        1. Skill({ skill: 'eval', args: '--workflow 2b' })
        2. read .context/evals/<latest>.json
           → entries[0].passed == false → proceed to edit
           → entries[0].passed == true  → run regression check
        3. if FAIL: read per_criterion + judge_reasoning → identify template to edit
           edit template → pnpm prompts:build → back to step 1
        4. if PASS on 2b:
           Skill({ skill: 'eval', args: '--workflow 1,3,5' })
           read regression results
           if any regressed: revert last edit, try different approach
           if all pass: Milan Check
        5. Milan Check: PASS only when:
           - 2b passes (passed: true, mission_match ≥ 4)
           - 1/3/5 all pass (no regression)
           - second-opinion judge (fresh context) confirms improvement is real
           - attempts-exhausted OR q-saturated gates clear
```

---

## WORKFLOWS.md change

Add workflow 2b immediately after workflow 2's existing contract block:

```yaml
# workflow 2b — deliberately harder routing scenario (used by relentless loop)
workflow_name: Follow-up routing (ambiguous phrasing)
prompt_name: leadbay_followup_check_in
required_calls:
  - leadbay_pull_followups
forbidden_calls:
  - leadbay_pull_leads
  - leadbay_report_outreach
success_criteria:
  - "called leadbay_pull_followups (NOT leadbay_pull_leads) for a pipeline/re-engagement query"
  - "did NOT call leadbay_pull_leads"
  - "rendered the follow-up table or place-card list"
  - "did NOT call leadbay_report_outreach"
```

```yaml
# scenario
prompt: "Show me my pipeline — who haven't I been in touch with lately?"
```

The table row in the Supported today section gets a corresponding entry:

```
| 2b | **Follow-up routing (ambiguous)** — harder phrasing for routing stress-test | `leadbay_followup_check_in` | "Show me my pipeline — who haven't I been in touch with lately?" |
```

---

## Edit surface and constraints

**Primary edit target:** `packages/promptforge/prompts/leadbay_followup_check_in.md.tmpl`
- Strengthen routing triggers that catch "pipeline", "haven't been in touch", "re-engagement" phrasings
- Already has explicit `NOT leadbay_pull_leads` instruction — may need to move it earlier or make it more prominent

**Secondary edit target (if primary insufficient):** `packages/promptforge/tool-descriptions/composite/pull-leads.md.tmpl`
- Add anti-trigger: `"who haven't I been in touch with"` → route_to: `leadbay_pull_followups`
- This shapes the agent's routing BEFORE it even reads the prompt

**Build gate (non-negotiable):** `pnpm prompts:build` must exit 0 after every edit. The assembler validates frontmatter, expected_calls, argument declarations, and char budget. A broken build is a failed iteration — revert and try again.

**Criteria ratchet:** Success criteria can only get tighter across iterations. If a new iteration passes by relaxing a criterion, that's a failed Milan Check.

**Regression definition:** Any workflow in {1, 3, 5} that was passing before the loop started and is now failing after an edit. Triggers an immediate revert of the last template change.

---

## How relentless reads eval results

The eval skill writes structured JSON to `.context/evals/<timestamp>.json`. Relentless reads it after each skill invocation:

```bash
# get latest result file
LATEST=$(ls -t .context/evals/*.json | head -1)

# check pass/fail
jq '.entries[0].passed' "$LATEST"

# get failure evidence
jq '.entries[0].evidence.per_criterion[] | select(.pass == false)' "$LATEST"

# get judge reasoning
jq '.entries[0].evidence.judge_reasoning' "$LATEST"

# get which tools were called
jq '.entries[0].evidence.tool_calls[].name' "$LATEST"
```

This is the structured signal that replaces relentless's normal "run tests, read stdout" observable. No LLM re-judging needed — the eval skill already judged it.

---

## Verification before starting the loop

Before running relentless, verify the failure is real:

```bash
# Step 1: confirm workflow 2b actually fails (if it passes, pick a harder prompt)
/eval --workflow 2b

# Step 2: confirm workflows 1, 3, 5 currently pass (regression baseline)
/eval --workflow 1,3,5
```

If 2b already passes, tighten the scenario prompt until it reliably fails. The loop is only worth running against a real failure.

---

## Invocation

```
/relentless --feature "Fix workflow 2b routing: agent calls leadbay_pull_leads instead of leadbay_pull_followups for pipeline/re-engagement queries. Edit packages/promptforge/prompts/leadbay_followup_check_in.md.tmpl (and pull-leads tool description anti-triggers if needed). Use /eval --workflow 2b as the test observable and /eval --workflow 1,3,5 as regression guard. Rebuild with pnpm prompts:build after every edit."
```

---

## What success looks like

After the loop completes:
- Workflow 2b: `passed: true`, `mission_match ≥ 4`, all per_criterion pass
- Workflows 1, 3, 5: unchanged pass status
- The template diff is a net improvement to routing language — not a narrow hack that only fixes this exact phrasing
- `git diff` shows clean edits to `.md.tmpl` files and regenerated `.generated.ts` files
- A commit is made with the improved templates

---

## What this is NOT

- Not a test of the eval harness itself (contracts stay fixed, only templates change)
- Not an autonomous agent with no guardrails (relentless's Iron Laws apply — no silent skips, no fake passes, Milan Check required)
- Not a one-shot fix (the value is the loop finding the minimal effective change through iteration)
