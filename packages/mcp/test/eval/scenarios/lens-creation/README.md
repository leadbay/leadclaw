# Eval scenarios — sector-creation crash class (`leadbay_new_lens` / `leadbay_adjust_audience`)

Two scenarios locking the v0.17.3 fix for the sector-creation crash
(telemetry 30d ending 2026-06-12: `leadbay_adjust_audience` 61% fail rate,
19 `TypeError`s). Both are authored to the scenario shape in `../../README.md`
(§"Adding a scenario") and are fixture-complete — they run as soon as the
scenario-execution glue (`helpers/run-eval.ts`, `setupScenarioFixtures`,
`runScenarioEval`, `vitest.eval.config.ts`) lands. That glue does not exist on
this branch yet, so there is intentionally **no `prompts/*.eval.ts` wiring
file** — adding one would import a module that doesn't exist and break the
build.

Because the bug is **deterministic** (an HTTP-body shape + a null-guard, not an
LLM judgement), the red/green regression proof lives at the unit layer, where
it can fail-closed in CI on every PR:

- `packages/core/test/unit/composite/new-lens-string-base-regression.test.ts`
- `packages/core/test/unit/composite/adjust-audience-dirty-taxonomy-regression.test.ts`

The `/eval`-level contracts for these two intents live in `WORKFLOWS.md`
(workflow 14 "Lens creation — make a named audience" and workflow 25
"Audience build from dirty taxonomy (no-crash)") — that table is the only
contract source `/eval` reads.

| Scenario | Failure mode it catches |
|---|---|
| `new-lens-string-base` | **400 / deserialization crash.** `POST /lenses` must send `base` as a STRING (lens ids are strings server-side); a numeric base 400s with "JSON deserialization error" and the lens is never created. Also asserts the `POST /lenses/:id/filter` body is the unwrapped `{items:[...]}` shape, and that a null-name taxonomy row does not crash creation. Locks `new-lens.ts:192` `String(base)`. |
| `adjust-audience-dirty-taxonomy` | **`TypeError` on a dirty taxonomy.** A `{id, name: null}` row in `GET /sectors/all` used to throw "Cannot read properties of … (reading 'toLowerCase')" while scanning, killing the whole call regardless of the user's input. With ambiguous matches the tool must return a graceful `ambiguous_sectors` message, never a throw and never a half-built lens. Locks `adjust-audience.ts:35` `if (!s) return []`. |
