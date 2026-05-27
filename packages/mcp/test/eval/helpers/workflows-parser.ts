/**
 * workflows-parser: reads WORKFLOWS.md and extracts ```yaml expected
 * and ```yaml scenario blocks from the contracts section.
 *
 * Blocks are matched by document order: the Nth `yaml expected` block
 * corresponds to workflow #N, the Nth `yaml scenario` to workflow #N.
 * Row numbers are no longer inferred from the table — the table is
 * human-readable only; the contracts section is the machine SSoT.
 *
 * Uses a zero-dependency line-by-line parser (the YAML subset used in
 * these blocks is flat string arrays only — no nesting, no anchors).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");
const WORKFLOWS_MD = resolve(REPO_ROOT, "WORKFLOWS.md");

export interface WorkflowExpected {
  workflow_id: number;
  workflow_name: string;
  prompt_name: string | null;
  required_calls: string[];
  forbidden_calls: string[];
  required_order: string[];
  required_byproducts: string[];
  success_criteria: string[];
}

export interface WorkflowScenario {
  workflow_id: number;
  prompt: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let _cache: Map<number, WorkflowExpected> | null = null;
let _scenarioCache: Map<number, WorkflowScenario> | null = null;

export function getWorkflowExpected(workflow_id: number): WorkflowExpected {
  if (!_cache) _cache = parseWorkflowsFile();
  const entry = _cache.get(workflow_id);
  if (!entry) {
    throw new Error(
      `workflows-parser: no 'expected' block found for workflow #${workflow_id} in WORKFLOWS.md. ` +
        "Add a ```yaml expected block to the contracts section.",
    );
  }
  return entry;
}

export function getAllWorkflowExpected(): Map<number, WorkflowExpected> {
  if (!_cache) _cache = parseWorkflowsFile();
  return _cache;
}

export function getWorkflowScenario(workflow_id: number): WorkflowScenario {
  if (!_scenarioCache) _scenarioCache = parseScenarioBlocks();
  const entry = _scenarioCache.get(workflow_id);
  if (!entry) {
    throw new Error(
      `workflows-parser: no 'scenario' block found for workflow #${workflow_id} in WORKFLOWS.md. ` +
        "Add a ```yaml scenario block to the contracts section.",
    );
  }
  return entry;
}

export function getAllWorkflowScenarios(): Map<number, WorkflowScenario> {
  if (!_scenarioCache) _scenarioCache = parseScenarioBlocks();
  return _scenarioCache;
}

// ---------------------------------------------------------------------------
// Parser — handles flat YAML string arrays only
// ---------------------------------------------------------------------------

function parseWorkflowsFile(): Map<number, WorkflowExpected> {
  const source = readFileSync(WORKFLOWS_MD, "utf8");
  const map = new Map<number, WorkflowExpected>();

  const lines = source.split("\n");
  let workflowIndex = 0;
  let inExpectedBlock = false;
  let blockLines: string[] = [];

  for (const line of lines) {
    // Detect opening fence: ```yaml expected
    if (!inExpectedBlock && /^```yaml\s+expected\s*$/.test(line.trim())) {
      inExpectedBlock = true;
      blockLines = [];
      continue;
    }

    // Detect closing fence
    if (inExpectedBlock && line.trim() === "```") {
      inExpectedBlock = false;
      workflowIndex++;
      map.set(workflowIndex, parseYamlBlock(workflowIndex, blockLines));
      blockLines = [];
      continue;
    }

    if (inExpectedBlock) {
      blockLines.push(line);
    }
  }

  return map;
}

/**
 * Minimal flat YAML parser — handles:
 *   key: scalar value   (string scalar, quoted or unquoted; "~" → null)
 *   key:                (starts a string-array section)
 *     - value           (list item, quoted or unquoted)
 *
 * No nesting, no anchors, no multi-line scalars. Sufficient for these blocks.
 */
function parseYamlBlock(workflow_id: number, lines: string[]): WorkflowExpected {
  const arrays: Record<string, string[]> = {};
  const scalars: Record<string, string | null> = {};
  let currentKey: string | null = null;

  for (const line of lines) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;

    // Scalar key line: "key: value" (has non-empty value after colon)
    const scalarMatch = line.match(/^([a-z_]+):\s+(.+)$/);
    if (scalarMatch) {
      currentKey = null; // scalars don't accumulate list items
      const key = scalarMatch[1];
      let value: string | null = scalarMatch[2].trim();
      if (value === "~" || value === "null") value = null;
      else if ((value.startsWith('"') && value.endsWith('"')) ||
               (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      scalars[key] = value;
      continue;
    }

    // Array key line: "key:" (no value after colon)
    const keyMatch = line.match(/^([a-z_]+):\s*$/);
    if (keyMatch) {
      currentKey = keyMatch[1];
      arrays[currentKey] = [];
      continue;
    }

    // List item: "  - value" or '  - "quoted value"'
    const itemMatch = line.match(/^\s+-\s+(.+)$/);
    if (itemMatch && currentKey) {
      let value = itemMatch[1].trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      arrays[currentKey].push(value);
    }
  }

  return {
    workflow_id,
    workflow_name: scalars.workflow_name ?? `Workflow #${workflow_id}`,
    prompt_name: "prompt_name" in scalars ? scalars.prompt_name : null,
    required_calls: arrays.required_calls ?? [],
    forbidden_calls: arrays.forbidden_calls ?? [],
    required_order: arrays.required_order ?? [],
    required_byproducts: arrays.required_byproducts ?? [],
    success_criteria: arrays.success_criteria ?? [],
  };
}

// ---------------------------------------------------------------------------
// Scenario block parser — handles ```yaml scenario blocks
// ---------------------------------------------------------------------------

function parseScenarioBlocks(): Map<number, WorkflowScenario> {
  const source = readFileSync(WORKFLOWS_MD, "utf8");
  const map = new Map<number, WorkflowScenario>();

  const lines = source.split("\n");
  let workflowIndex = 0;
  let inExpectedBlock = false;
  let inScenarioBlock = false;
  let blockLines: string[] = [];

  for (const line of lines) {
    // Track expected blocks to keep index in sync with parseWorkflowsFile
    if (!inExpectedBlock && !inScenarioBlock && /^```yaml\s+expected\s*$/.test(line.trim())) {
      inExpectedBlock = true;
      continue;
    }
    if (inExpectedBlock && line.trim() === "```") {
      inExpectedBlock = false;
      workflowIndex++;
      continue;
    }

    // Detect opening fence for scenario block
    if (!inExpectedBlock && !inScenarioBlock && /^```yaml\s+scenario\s*$/.test(line.trim())) {
      inScenarioBlock = true;
      blockLines = [];
      continue;
    }

    // Close scenario block
    if (inScenarioBlock && line.trim() === "```") {
      inScenarioBlock = false;
      const scenario = parseScenarioYaml(workflowIndex, blockLines);
      if (scenario) map.set(workflowIndex, scenario);
      blockLines = [];
      continue;
    }

    if (inScenarioBlock) {
      blockLines.push(line);
    }
  }

  return map;
}

function parseScenarioYaml(workflow_id: number, lines: string[]): WorkflowScenario | null {
  for (const line of lines) {
    // Match "prompt: <value>" (quoted or unquoted)
    const m = line.match(/^prompt:\s*(.+)$/);
    if (m) {
      let value = m[1].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return { workflow_id, prompt: value };
    }
  }
  return null;
}
