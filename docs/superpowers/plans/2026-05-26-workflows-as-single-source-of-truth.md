# WORKFLOWS.md as Single Source of Truth for Eval Specs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make WORKFLOWS.md the single source of truth for what each eval expects — `required_calls`, `forbidden_calls`, `required_byproducts`, and `success_criteria` live in WORKFLOWS.md as structured yaml blocks; all `invariants/*.ts` files and the `mission` objects in scenario files are deleted and replaced by a generic runtime parser.

**Architecture:** Each "Supported" workflow row in WORKFLOWS.md gets a fenced ` ```yaml expected ``` ` block immediately below it containing the eval contract. A new `helpers/workflows-parser.ts` reads and parses these blocks at test runtime. `run-eval.ts` and `mission-match-judge.ts` accept the parsed contract instead of inline TypeScript objects. All 12 `invariants/*.ts` files and the `mission` field on every scenario are deleted.

**Tech Stack:** TypeScript, Vitest, Node.js `fs`, existing `@leadbay/mcp` test harness.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Modify | `WORKFLOWS.md` | Add `expected` yaml block under each of the 11 Supported rows |
| Create | `packages/mcp/test/eval/helpers/workflows-parser.ts` | Parse WORKFLOWS.md, return typed `WorkflowExpected` per workflow ID |
| Modify | `packages/mcp/test/eval/helpers/run-eval.ts` | Accept `WorkflowExpected` from parser instead of `invariants` fn + `scenario.mission` |
| Modify | `packages/mcp/test/eval/scenarios/daily-check-in/clean-batch.scenario.ts` | Remove `mission` field; add `workflow_id: 1` |
| Modify | `packages/mcp/test/eval/scenarios/daily-check-in/rendering-table-contract.scenario.ts` | Same |
| Modify | `packages/mcp/test/eval/scenarios/daily-check-in/widget-overdelivery-guard.scenario.ts` | Same |
| Modify | `packages/mcp/test/eval/scenarios/followup-check-in/*.scenario.ts` (3 files) | Same |
| Modify | `packages/mcp/test/eval/scenarios/import-file/dirty-hubspot-deals.scenario.ts` | Same |
| Modify | `packages/mcp/test/eval/scenarios/log-outreach/user-confirmed.scenario.ts` | Same |
| Modify | `packages/mcp/test/eval/scenarios/qualify-top-n/*.scenario.ts` (2 files) | Same |
| Modify | `packages/mcp/test/eval/scenarios/refine-audience/clarification-roundtrip.scenario.ts` | Same |
| Modify | `packages/mcp/test/eval/scenarios/research-a-domain/*.scenario.ts` (2 files) | Same |
| Modify | `packages/mcp/test/eval/scenarios/work-campaign/default-readiness.scenario.ts` | Same |
| Modify | `packages/mcp/test/eval/scenarios/outreach-drafting/prepare-brief.scenario.ts` | Same |
| Modify | `packages/mcp/test/eval/scenarios/plan-tour-in-city/city-itinerary.scenario.ts` | Same |
| Modify | `packages/mcp/test/eval/scenarios/prospecting-overview/account-state-report.scenario.ts` | Same |
| Modify | `packages/mcp/test/eval/scenarios/setup-team-prospecting/create-lens-and-campaign.scenario.ts` | Same |
| Modify | all `packages/mcp/test/eval/prompts/*.eval.ts` (13 files) | Remove `invariants` import; pass `workflow_id` to runner |
| Delete | `packages/mcp/test/eval/invariants/*.ts` (12 files) | Replaced by parser |
| Modify | `packages/mcp/test/audit/workflows-eval-coverage.test.ts` | Also assert each Supported row has a valid `expected` block |

---

## Task 1: Add `expected` yaml blocks to WORKFLOWS.md

**Files:**
- Modify: `WORKFLOWS.md`

The yaml block goes **immediately after** each table row (blank line, then fenced block, then blank line before next row). The block label must be exactly ` ```yaml expected ``` ` so the parser can find it by language tag.

Schema for each block:
```yaml
required_calls:         # tools that MUST appear in the session (at least once each)
  - leadbay_foo
forbidden_calls:        # tools that MUST NOT appear
  - leadbay_bar
required_order:         # subsequence that must appear in this left-to-right order (optional)
  - leadbay_foo
  - leadbay_baz
required_byproducts:    # phrases that must appear in agent prose (optional)
  - "STOP — awaiting user decision"
success_criteria:       # human-readable strings fed to the LLM judge
  - "called leadbay_foo at least once"
```

- [ ] **Step 1: Add block for workflow #1 — Daily lead discovery**

In `WORKFLOWS.md`, after the row `| 1 | **Daily lead discovery**...`, add:

```
```yaml expected
required_calls:
  - leadbay_account_status
  - leadbay_pull_leads
  - leadbay_research_lead_by_id
forbidden_calls:
  - leadbay_report_outreach
required_order:
  - leadbay_account_status
  - leadbay_pull_leads
  - leadbay_research_lead_by_id
required_byproducts:
  - "STOP — awaiting user decision"
success_criteria:
  - "called leadbay_account_status exactly once"
  - "called leadbay_pull_leads exactly once"
  - "called leadbay_research_lead_by_id at least once on the top-scoring lead"
  - "emitted STOP — awaiting user decision byproduct"
  - "did NOT call leadbay_report_outreach"
  - "did NOT call leadbay_enrich_contacts without explicit user confirmation"
```
```

- [ ] **Step 2: Add block for workflow #2 — Follow-up check-in**

```
```yaml expected
required_calls:
  - leadbay_pull_followups
forbidden_calls:
  - leadbay_pull_leads
  - leadbay_report_outreach
required_byproducts:
  - "STOP — awaiting user decision"
success_criteria:
  - "called leadbay_pull_followups at least once (Monitor view)"
  - "did NOT call leadbay_pull_leads (wrong entry point for follow-up queries)"
  - "did NOT call leadbay_report_outreach"
  - "emitted STOP — awaiting user decision byproduct"
```
```

- [ ] **Step 3: Add block for workflow #3 — Single-domain research**

```
```yaml expected
required_calls:
  - leadbay_research_lead_by_id
forbidden_calls:
  - leadbay_report_outreach
success_criteria:
  - "called leadbay_research_lead_by_id at least once"
  - "rendered a research card with company name, score, and contact"
  - "did NOT call leadbay_report_outreach"
```
```

- [ ] **Step 4: Add block for workflow #4 — CSV import + qualify**

```
```yaml expected
required_calls:
  - leadbay_import_leads
  - leadbay_bulk_qualify_leads
forbidden_calls:
  - leadbay_report_outreach
success_criteria:
  - "called leadbay_import_leads at least once"
  - "called leadbay_bulk_qualify_leads at least once"
  - "did NOT call leadbay_report_outreach"
```
```

- [ ] **Step 5: Add block for workflow #5 — Qualify top-N**

```
```yaml expected
required_calls:
  - leadbay_bulk_qualify_leads
forbidden_calls:
  - leadbay_report_outreach
success_criteria:
  - "called leadbay_bulk_qualify_leads at least once"
  - "rendered a qualification results table"
  - "did NOT call leadbay_report_outreach"
```
```

- [ ] **Step 6: Add block for workflow #6 — Audience refinement**

```
```yaml expected
required_calls:
  - leadbay_refine_prompt
forbidden_calls:
  - leadbay_report_outreach
success_criteria:
  - "called leadbay_refine_prompt at least once with the user's instruction"
  - "confirmed the refinement was applied"
  - "did NOT call leadbay_report_outreach"
```
```

- [ ] **Step 7: Add block for workflow #7 — Prospecting overview**

```
```yaml expected
required_calls:
  - leadbay_account_status
forbidden_calls:
  - leadbay_report_outreach
success_criteria:
  - "called leadbay_account_status at least once"
  - "reported remaining quota figures without fabrication"
  - "proposed a concrete next step"
  - "did NOT call leadbay_report_outreach or any mutating tool"
```
```

- [ ] **Step 8: Add block for workflow #8 — Outreach drafting**

```
```yaml expected
required_calls:
  - leadbay_prepare_outreach
forbidden_calls:
  - leadbay_report_outreach
success_criteria:
  - "called leadbay_prepare_outreach at least once with the correct lead ID"
  - "used brief data (company description, contact name, recent signals) in the draft"
  - "did NOT call leadbay_report_outreach (logging is a separate step)"
```
```

- [ ] **Step 9: Add block for workflow #9 — Outreach logging**

```
```yaml expected
required_calls:
  - leadbay_report_outreach
success_criteria:
  - "called leadbay_report_outreach with source and ref fields populated"
  - "confirmed the outreach was logged"
```
```

- [ ] **Step 10: Add block for workflow #10 — Field sales tour**

```
```yaml expected
required_calls:
  - leadbay_tour_plan
forbidden_calls:
  - leadbay_pull_leads
  - leadbay_report_outreach
success_criteria:
  - "called leadbay_tour_plan with the correct city (not raw pull_followups + pull_leads)"
  - "included Monitor follow-up leads in the itinerary"
  - "included geo-matched Discover leads and excluded non-matching ones"
  - "presented the itinerary as a map or place-card list"
  - "did NOT call leadbay_report_outreach"
```
```

- [ ] **Step 11: Add block for workflow #11 — Manager-led team prospecting**

```
```yaml expected
required_calls:
  - leadbay_pull_leads
  - leadbay_create_campaign
forbidden_calls:
  - leadbay_report_outreach
success_criteria:
  - "created or activated a lens targeting the audience"
  - "called leadbay_pull_leads to validate the lens"
  - "created at least one named campaign via leadbay_create_campaign"
  - "did NOT call leadbay_report_outreach"
```
```

- [ ] **Step 12: Verify the file is valid markdown (no broken tables)**

```bash
pnpm --filter @leadbay/mcp test -- packages/mcp/test/audit/workflows.test.ts
```
Expected: all 3 tests pass (identifiers valid, paths exist, table column counts match).

---

## Task 2: Write `workflows-parser.ts`

**Files:**
- Create: `packages/mcp/test/eval/helpers/workflows-parser.ts`

This module reads `WORKFLOWS.md`, finds every ` ```yaml expected ``` ` block, and returns a typed object indexed by workflow number.

- [ ] **Step 1: Write the parser**

```typescript
// packages/mcp/test/eval/helpers/workflows-parser.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { parse as parseYaml } from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..", "..");
const WORKFLOWS_MD = resolve(REPO_ROOT, "WORKFLOWS.md");

export interface WorkflowExpected {
  workflow_id: number;
  required_calls: string[];
  forbidden_calls: string[];
  required_order: string[];
  required_byproducts: string[];
  success_criteria: string[];
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

let _cache: Map<number, WorkflowExpected> | null = null;

export function getWorkflowExpected(workflow_id: number): WorkflowExpected {
  if (!_cache) _cache = parseWorkflowsFile();
  const entry = _cache.get(workflow_id);
  if (!entry) {
    throw new Error(
      `workflows-parser: no 'expected' block found for workflow #${workflow_id} in WORKFLOWS.md. ` +
        `Add a \`\`\`yaml expected block immediately after the row.`,
    );
  }
  return entry;
}

export function getAllWorkflowExpected(): Map<number, WorkflowExpected> {
  if (!_cache) _cache = parseWorkflowsFile();
  return _cache;
}

function parseWorkflowsFile(): Map<number, WorkflowExpected> {
  const source = readFileSync(WORKFLOWS_MD, "utf8");
  const map = new Map<number, WorkflowExpected>();

  // Split on fenced code blocks tagged "yaml expected"
  // Pattern: a table row starting with "| N |", then optionally blank lines,
  // then ```yaml expected ... ```.
  const lines = source.split("\n");
  let lastRowNum: number | null = null;
  let inExpectedBlock = false;
  let blockLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect a Supported table data row: starts with "| <digits> |"
    const rowMatch = line.match(/^\|\s*(\d+)\s*\|/);
    if (rowMatch && !inExpectedBlock) {
      lastRowNum = parseInt(rowMatch[1], 10);
      continue;
    }

    // Detect opening fence: ```yaml expected
    if (!inExpectedBlock && /^```yaml\s+expected\s*$/.test(line.trim())) {
      inExpectedBlock = true;
      blockLines = [];
      continue;
    }

    // Detect closing fence
    if (inExpectedBlock && line.trim() === "```") {
      inExpectedBlock = false;
      if (lastRowNum !== null) {
        const parsed = parseYaml(blockLines.join("\n")) as Record<string, unknown>;
        map.set(lastRowNum, normalizeExpected(lastRowNum, parsed));
      }
      blockLines = [];
      continue;
    }

    if (inExpectedBlock) {
      blockLines.push(line);
    }
  }

  return map;
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function normalizeExpected(workflow_id: number, raw: Record<string, unknown>): WorkflowExpected {
  return {
    workflow_id,
    required_calls: toStringArray(raw.required_calls),
    forbidden_calls: toStringArray(raw.forbidden_calls),
    required_order: toStringArray(raw.required_order),
    required_byproducts: toStringArray(raw.required_byproducts),
    success_criteria: toStringArray(raw.success_criteria),
  };
}
```

- [ ] **Step 2: Check `yaml` package is available**

```bash
grep '"yaml"' /home/arty/orca/workspaces/leadclaw/eval-framework/packages/mcp/package.json
```

If absent, add it:
```bash
pnpm --filter @leadbay/mcp add yaml
```

The `yaml` package (npm: `yaml`) is a zero-dependency YAML parser, already common in the JS ecosystem. If it is already a transitive dep of another package in the monorepo, no install needed — just import it.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @leadbay/mcp typecheck
```
Expected: no errors.

---

## Task 3: Update `ScenarioFixture` interface — replace `mission` with `workflow_id`

**Files:**
- Modify: `packages/mcp/test/eval/scenarios/daily-check-in/clean-batch.scenario.ts` (owns the shared `ScenarioFixture` interface)

The `ScenarioFixture` interface is currently defined here and re-exported to other scenario files. Replace the `mission: MissionMatchScenario` field with `workflow_id: number`.

- [ ] **Step 1: Update the interface in `clean-batch.scenario.ts`**

Replace:
```typescript
import type { MissionMatchScenario } from "../../helpers/mission-match-judge.js";

export interface ScenarioFixture<TArgs = Record<string, string | undefined>> {
  name: string;
  prompt: string;
  tier: "gate" | "periodic";
  args: TArgs;
  backendFixtures: BackendFixture[];
  mission: MissionMatchScenario;
}
```

With:
```typescript
export interface ScenarioFixture<TArgs = Record<string, string | undefined>> {
  name: string;
  prompt: string;
  tier: "gate" | "periodic";
  args: TArgs;
  backendFixtures: BackendFixture[];
  workflow_id: number;
}
```

Also update the `SCENARIO` export in this file: remove the entire `mission: { ... }` object, replace with `workflow_id: 1`.

- [ ] **Step 2: Typecheck to find all broken callers**

```bash
pnpm --filter @leadbay/mcp typecheck 2>&1 | grep "mission\|workflow_id" | head -40
```

This lists every scenario file that still has the old `mission` field — the next task fixes them all.

---

## Task 4: Migrate all scenario files — remove `mission`, add `workflow_id`

**Files:**  
Each file below: remove the `mission: { ... }` object, add `workflow_id: N` where N matches the WORKFLOWS.md row number.

Workflow ID mapping:
| File | workflow_id |
|---|---|
| `scenarios/daily-check-in/clean-batch.scenario.ts` | 1 (done in Task 3) |
| `scenarios/daily-check-in/rendering-table-contract.scenario.ts` | 1 |
| `scenarios/daily-check-in/widget-overdelivery-guard.scenario.ts` | 1 |
| `scenarios/followup-check-in/cross-mode-pivot.scenario.ts` | 2 |
| `scenarios/followup-check-in/geo-followup.scenario.ts` | 2 |
| `scenarios/followup-check-in/routing-regression.scenario.ts` | 2 |
| `scenarios/import-file/dirty-hubspot-deals.scenario.ts` | 4 |
| `scenarios/log-outreach/user-confirmed.scenario.ts` | 9 |
| `scenarios/qualify-top-n/default-batch.scenario.ts` | 5 |
| `scenarios/qualify-top-n/rendering-refresh-table.scenario.ts` | 5 |
| `scenarios/refine-audience/clarification-roundtrip.scenario.ts` | 6 |
| `scenarios/research-a-domain/clean-domain.scenario.ts` | 3 |
| `scenarios/research-a-domain/rendering-card-contract.scenario.ts` | 3 |
| `scenarios/work-campaign/default-readiness.scenario.ts` | 11 |
| `scenarios/outreach-drafting/prepare-brief.scenario.ts` | 8 |
| `scenarios/plan-tour-in-city/city-itinerary.scenario.ts` | 10 |
| `scenarios/prospecting-overview/account-state-report.scenario.ts` | 7 |
| `scenarios/setup-team-prospecting/create-lens-and-campaign.scenario.ts` | 11 |

- [ ] **Step 1: For each file, remove `mission` and add `workflow_id`**

In every scenario file (except `clean-batch.scenario.ts` already done), make these two changes:

1. Remove the line `import type { MissionMatchScenario } from "../../helpers/mission-match-judge.js";` if present (it's only in files that define their own type locally — check before removing)
2. In the `SCENARIO` export object, delete the `mission: { ... }` block entirely and add `workflow_id: N,` (using the ID from the table above)

Example diff for `rendering-table-contract.scenario.ts`:
```diff
-  mission: {
-    prompt_name: "leadbay_daily_check_in",
-    scenario_name: "rendering-table-contract",
-    user_intent: "...",
-    success_criteria: [...],
-    required_calls: [...],
-    required_byproducts: [...],
-    forbidden_calls: [...],
-  },
+  workflow_id: 1,
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @leadbay/mcp typecheck
```
Expected: no errors about `mission` or `workflow_id`.

---

## Task 5: Update `run-eval.ts` — read expected contract from parser

**Files:**
- Modify: `packages/mcp/test/eval/helpers/run-eval.ts`

`runScenarioEval` currently accepts `invariants: (e: MCPEvidence) => InvariantResult[]`. Replace with a lookup from the parser. The generic invariant checks (required_calls, forbidden_calls, required_order, required_byproducts) are now derived from `WorkflowExpected`.

- [ ] **Step 1: Replace the `invariants` parameter with `workflow_id` resolution**

Replace the `RunScenarioEvalOpts` interface and the body of `runScenarioEval`:

```typescript
// NEW imports at top of run-eval.ts
import { getWorkflowExpected } from "./workflows-parser.js";

// Updated interface — remove invariants, it's derived from WORKFLOWS.md
export interface RunScenarioEvalOpts {
  scenario: ScenarioLike;
  max_turns?: number;
}

// Updated ScenarioLike — mission replaced by workflow_id
export interface ScenarioLike {
  name: string;
  prompt: string;
  tier: "gate" | "periodic";
  args: Record<string, string | undefined>;
  backendFixtures: BackendFixture[];
  workflow_id: number;
}
```

Replace the `runScenarioEval` body: where it currently calls `invariants(sessionResult.evidence)`, replace with a generic derivation from `WorkflowExpected`:

```typescript
export async function runScenarioEval(opts: RunScenarioEvalOpts): Promise<void> {
  const { scenario, max_turns = 20 } = opts;
  const expected = getWorkflowExpected(scenario.workflow_id);

  // ... (keep existing rendered prompt + runSessionCLI logic unchanged) ...

  // Replace: const inv = invariants(sessionResult.evidence);
  // With: generic invariant checks from WorkflowExpected
  const inv = deriveInvariants(sessionResult.evidence, expected);
  sessionResult.evidence.invariants = inv;

  // Build MissionMatchScenario from WorkflowExpected (for the judge)
  const mission: MissionMatchScenario = {
    prompt_name: scenario.prompt,
    scenario_name: scenario.name,
    user_intent: `Execute the ${scenario.prompt} workflow as described in WORKFLOWS.md workflow #${scenario.workflow_id}`,
    success_criteria: expected.success_criteria,
    required_calls: expected.required_calls,
    required_byproducts: expected.required_byproducts,
    forbidden_calls: expected.forbidden_calls,
  };

  const judgeOutcome = await runMissionMatchJudge({
    promptforgeRoot: PROMPTFORGE_ROOT,
    scenario: mission,
    evidence: sessionResult.evidence,
  });

  // ... (keep existing judge outcome handling, console output, collector, assertions) ...
}
```

Add the `deriveInvariants` helper (replaces all 12 `invariants/*.ts` files):

```typescript
function deriveInvariants(
  evidence: MCPEvidence,
  expected: WorkflowExpected,
): InvariantResult[] {
  const results: InvariantResult[] = [];
  const calls = evidence.tool_calls.map((c) => c.name);
  const allProse =
    evidence.final_agent_message + "\n" +
    evidence.prose_between_tool_calls.map((p) => p.text).join("\n");

  // required_calls: each must appear at least once
  for (const name of expected.required_calls) {
    const count = calls.filter((c) => c === name).length;
    results.push({
      name: `required_call.${name}`,
      pass: count >= 1,
      reason: count >= 1 ? undefined : `expected ≥1 call to ${name}, observed 0`,
    });
  }

  // forbidden_calls: none must appear
  for (const name of expected.forbidden_calls) {
    const count = calls.filter((c) => c === name).length;
    results.push({
      name: `forbidden_call.${name}`,
      pass: count === 0,
      reason: count === 0 ? undefined : `forbidden tool ${name} was called ${count} times`,
    });
  }

  // required_order: subsequence must appear left-to-right
  if (expected.required_order.length >= 2) {
    const sequence = expected.required_order;
    let i = 0;
    for (const call of calls) {
      if (i < sequence.length && call === sequence[i]) i++;
    }
    const pass = i === sequence.length;
    results.push({
      name: `required_order.${sequence.join("→")}`,
      pass,
      reason: pass
        ? undefined
        : `expected order ${sequence.join(" → ")} not observed in: ${calls.join(", ")}`,
    });
  }

  // required_byproducts: each phrase must appear in prose
  for (const phrase of expected.required_byproducts) {
    const pass = allProse.includes(phrase);
    results.push({
      name: `byproduct.${phrase.slice(0, 40)}`,
      pass,
      reason: pass ? undefined : `required phrase not in agent prose: "${phrase}"`,
    });
  }

  return results;
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @leadbay/mcp typecheck
```
Expected: no errors.

---

## Task 6: Update all `.eval.ts` files — remove `invariants` import

**Files:**
All 13 files in `packages/mcp/test/eval/prompts/`.

Currently each imports its invariants file:
```typescript
import { dailyCheckInInvariants } from "../invariants/daily-check-in.js";
// ...
await runScenarioEval({ scenario: SCENARIO, invariants: dailyCheckInInvariants, max_turns: 12 });
```

After Task 5, `runScenarioEval` no longer accepts `invariants`. Update each file:

- [ ] **Step 1: For each `.eval.ts`, remove the invariants import and parameter**

Example for `leadbay_daily_check_in.eval.ts`:
```diff
-import { dailyCheckInInvariants } from "../invariants/daily-check-in.js";
 
 // ...
-    await runScenarioEval({ scenario: SCENARIO, invariants: dailyCheckInInvariants, max_turns: 12 });
+    await runScenarioEval({ scenario: SCENARIO, max_turns: 12 });
```

Do this for all 13 files. The invariants are now derived from WORKFLOWS.md via the parser.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @leadbay/mcp typecheck
```
Expected: no errors.

- [ ] **Step 3: Run the full non-eval test suite to confirm nothing broke**

```bash
pnpm --filter @leadbay/mcp test
```
Expected: all tests pass (the eval tests are gated behind `EVAL=1` and won't run here).

---

## Task 7: Delete `invariants/*.ts` files

**Files:**
Delete all 12 files in `packages/mcp/test/eval/invariants/`:
- `daily-check-in.ts`
- `followup-check-in.ts`
- `import-file.ts`
- `log-outreach.ts`
- `outreach-drafting.ts`
- `plan-tour-in-city.ts`
- `prospecting-overview.ts`
- `qualify-top-n.ts`
- `refine-audience.ts`
- `research-a-domain.ts`
- `setup-team-prospecting.ts`
- `work-campaign.ts`

- [ ] **Step 1: Delete the files**

```bash
rm packages/mcp/test/eval/invariants/daily-check-in.ts \
   packages/mcp/test/eval/invariants/followup-check-in.ts \
   packages/mcp/test/eval/invariants/import-file.ts \
   packages/mcp/test/eval/invariants/log-outreach.ts \
   packages/mcp/test/eval/invariants/outreach-drafting.ts \
   packages/mcp/test/eval/invariants/plan-tour-in-city.ts \
   packages/mcp/test/eval/invariants/prospecting-overview.ts \
   packages/mcp/test/eval/invariants/qualify-top-n.ts \
   packages/mcp/test/eval/invariants/refine-audience.ts \
   packages/mcp/test/eval/invariants/research-a-domain.ts \
   packages/mcp/test/eval/invariants/setup-team-prospecting.ts \
   packages/mcp/test/eval/invariants/work-campaign.ts
```

- [ ] **Step 2: Typecheck — confirm no dangling imports**

```bash
pnpm --filter @leadbay/mcp typecheck
```
Expected: no errors (all imports were already removed in Task 6).

---

## Task 8: Update `workflows-eval-coverage.test.ts` — also assert `expected` blocks exist

**Files:**
- Modify: `packages/mcp/test/audit/workflows-eval-coverage.test.ts`

Add a second test that verifies every Supported row also has a ` ```yaml expected ``` ` block (not just an eval file).

> Note: the no-modify-existing-tests rule applies to test files that exercise product behavior. Audit files that enforce structural contracts are meta-tests and are extended, not replaced. This file was created in this same branch so extending it is fine.

- [ ] **Step 1: Add the assertion**

Add inside the `describe` block:

```typescript
it("each Supported row has a yaml expected block parseable by workflows-parser", () => {
  // Import inline to avoid circular dep issues at test collection time
  const { getAllWorkflowExpected } = require("../eval/helpers/workflows-parser.js");
  const all = getAllWorkflowExpected() as Map<number, unknown>;
  
  // Re-extract row numbers from WORKFLOWS.md
  const rows = extractSupportedRows(SOURCE);
  const missing = rows
    .map((r) => r.rowNum)
    .filter((id) => !all.has(id));

  expect(
    missing,
    `Supported rows without a yaml expected block: ${JSON.stringify(missing)}. ` +
      `Add a \`\`\`yaml expected block immediately after the row in WORKFLOWS.md.`,
  ).toEqual([]);
});
```

Since this is a `.test.ts` vitest file, use a regular import instead of `require`:

```typescript
import { getAllWorkflowExpected } from "../eval/helpers/workflows-parser.js";
```

Add this import at the top of the file alongside the existing imports.

- [ ] **Step 2: Run audit tests**

```bash
pnpm --filter @leadbay/mcp test -- packages/mcp/test/audit/
```
Expected: all audit tests pass.

---

## Task 9: Commit and push

- [ ] **Step 1: Final full test run**

```bash
pnpm --filter @leadbay/mcp test
pnpm --filter @leadbay/mcp typecheck
```
Expected: all pass, no errors.

- [ ] **Step 2: Commit**

```bash
git add WORKFLOWS.md \
  packages/mcp/test/eval/helpers/workflows-parser.ts \
  packages/mcp/test/eval/helpers/run-eval.ts \
  packages/mcp/test/eval/scenarios/ \
  packages/mcp/test/eval/prompts/ \
  packages/mcp/test/audit/workflows-eval-coverage.test.ts
git add -u packages/mcp/test/eval/invariants/   # stage the deletions
git commit -m "WORKFLOWS.md as single source of truth: expected blocks drive eval invariants"
```

- [ ] **Step 3: Push**

```bash
git push origin ArtyETH06/eval-framework
```

---

## Self-Review

**Spec coverage:**
- ✓ WORKFLOWS.md gets yaml expected blocks (Task 1)
- ✓ Parser reads them at runtime (Task 2)
- ✓ ScenarioFixture interface updated (Task 3)
- ✓ All scenario files migrated (Task 4)
- ✓ run-eval.ts derives invariants from parser (Task 5)
- ✓ .eval.ts files cleaned of invariants imports (Task 6)
- ✓ invariants/*.ts deleted (Task 7)
- ✓ Audit enforces expected blocks exist (Task 8)

**Type consistency check:**
- `WorkflowExpected` defined in Task 2, used in Task 5 — field names consistent (`required_calls`, `forbidden_calls`, `required_order`, `required_byproducts`, `success_criteria`)
- `ScenarioLike.workflow_id: number` defined in Task 3, read via `getWorkflowExpected(scenario.workflow_id)` in Task 5 — consistent
- `MissionMatchScenario` interface unchanged — Task 5 constructs it from `WorkflowExpected` fields, all required fields present
- `deriveInvariants` returns `InvariantResult[]` — matches what `evidence.invariants` expects (existing type unchanged)

**Placeholder scan:** No TBDs, no "implement later", all code blocks are complete.
