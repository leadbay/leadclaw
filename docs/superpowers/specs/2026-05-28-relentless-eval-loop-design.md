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

The agent calls `leadbay_pull_leads` (discovery) when it should call `leadbay_pull_followups` (Monitor/re-engagement). This is a **confirmed routing gap** found by reading the actual tool description triggers.

**Scenario prompt:** `"Show me leads I should reach out to today"`

**Why this reliably fails today:**

The `pull_leads` tool description has these routing triggers: "show me leads", "today's prospects", "best new leads". The phrase "show me leads" + "today" fires `pull_leads` immediately.

The `pull_followups` tool description triggers are: "what should I follow up on", "leads I've already worked", "what's overdue", "leads in \<city\>". None match "reach out to today".

The `pull_leads` anti-triggers only cover: "leads I should follow up with" and "I'm going to \<city\>". The phrase "reach out to" isn't covered.

So the agent reads "show me leads ... today" → routes to `pull_leads`. The contract forbids `pull_leads` and requires `pull_followups`. **Guaranteed failure with current routing.**

**Why this is a good target:**
- The failure is structural (routing gap), not random — it reproduces every run
- The fix is localized and specific: add "reach out to", "get back to", "contact today" as `pull_followups` triggers and/or `pull_leads` anti-triggers
- The eval signal is binary: either `pull_followups` was called or it wasn't
- The fix generalizes — "reach out" covers a whole class of re-engagement phrasings the current routing misses
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
# workflow 2b — routing stress-test: discovery-sounding phrasing that should route to follow-up
workflow_name: Follow-up routing (reach-out phrasing)
prompt_name: leadbay_followup_check_in
required_calls:
  - leadbay_pull_followups
forbidden_calls:
  - leadbay_pull_leads
  - leadbay_report_outreach
success_criteria:
  - "called leadbay_pull_followups (NOT leadbay_pull_leads) — re-engagement intent, not discovery"
  - "did NOT call leadbay_pull_leads"
  - "rendered the follow-up table with status badges (not a score-bar discovery table)"
  - "did NOT call leadbay_report_outreach"
```

```yaml
# scenario — triggers pull_leads routing today ("show me leads" + "today"), should route to pull_followups
prompt: "Show me leads I should reach out to today"
```

The table row in the Supported today section gets a corresponding entry:

```
| 2b | **Follow-up routing (reach-out)** — "reach out to today" currently misfires to pull_leads | `leadbay_followup_check_in` | "Show me leads I should reach out to today" |
```

---

## Edit surface and constraints

**Primary edit target:** `packages/promptforge/tool-descriptions/composite/pull-leads.md.tmpl`
- Add anti-triggers: `"reach out to"`, `"get back to"`, `"contact today"` → route_to: `leadbay_pull_followups`
- Tool description routing fires BEFORE the prompt is read — this is the right chokepoint

**Secondary edit target:** `packages/promptforge/tool-descriptions/composite/pull-followups.md.tmpl`
- Add triggers: `"reach out to today"`, `"should I contact"`, `"get back to"`, `"re-engage"`
- Symmetric fix — pull_followups should actively claim this phrasing class

**Tertiary edit target (if tool descriptions insufficient):** `packages/promptforge/prompts/leadbay_followup_check_in.md.tmpl`
- The prompt opening already lists trigger phrases — add "reach out to today", "leads to contact", "should get back to"
- The `NOT leadbay_pull_leads` instruction is already there but fires after routing — moving it to the very first line may help

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
/relentless --feature "Fix workflow 2b routing: the phrase 'Show me leads I should reach out to today' fires leadbay_pull_leads (discovery) instead of leadbay_pull_followups (Monitor re-engagement). Root cause: pull_leads has no anti-trigger for 'reach out to'; pull_followups has no trigger for this phrasing class. Fix by editing packages/promptforge/tool-descriptions/composite/pull-leads.md.tmpl (add anti-triggers) and pull-followups.md.tmpl (add triggers), rebuilding with pnpm prompts:build, then verifying with /eval --workflow 2b. Regression guard: /eval --workflow 1,3,5 must stay green. Do NOT narrow the fix to just this exact phrase — improve the whole 'reach out / contact / get back to' phrasing class."
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
