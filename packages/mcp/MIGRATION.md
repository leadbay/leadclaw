# Migration: leadclaw / leadbay-mcp 0.1.x → 0.2.0

This release is the autoplan-reviewed agent-experience overhaul. The OpenClaw
plugin and MCP server gain a coherent composite-tool surface so an AI agent
can drive Leadbay end-to-end with a handful of calls. The old granular tools
remain available behind config flags.

## Headline changes

- **`leadbay_find_prospects` removed** → replaced by **`leadbay_pull_leads`**
  (richer return: each lead carries a `qualification_summary` digest from
  `ai_agent_responses`, plus all the engagement-state flags).
- **New composite agent surface** (the agent's default toolbox):
  - `leadbay_pull_leads` — paginated wishlist with qualification digest
  - `leadbay_research_lead` — full lead detail (qualification → signals → firmographics → contacts → engagement)
  - `leadbay_recall_ordered_titles` — show titles previously enriched
  - `leadbay_account_status` — admin / language / quota / intelligence state
  - `leadbay_bulk_qualify_leads` — paginate past already-qualified, fan-out + poll
  - `leadbay_enrich_titles` — selection-lifecycle-managed bulk enrichment
  - `leadbay_adjust_audience` — sector / size filter mutation with permission auto-routing
  - `leadbay_refine_prompt` — set the org intelligence-refinement prompt
  - `leadbay_answer_clarification` — answer the question Leadbay raised
  - `leadbay_report_outreach` — log outreach **with mandatory verification**
- **New gating model** (both MCP and OpenClaw):
  - **Composite reads**: always exposed.
  - **Composite writes**: gated by `LEADBAY_MCP_WRITE=1` (MCP) or
    `exposeWrite: true` plugin config (OpenClaw).
  - **Granular reads**: gated by `LEADBAY_MCP_ADVANCED=1` (MCP) or
    `exposeGranular: true` (OpenClaw).
  - **Granular writes**: gated by BOTH advanced AND write flags.
- **`leadbay_login` auto-detects region** (us → fr fallback). The user no
  longer needs to know which backend their account is in.
- **`leadbay_get_quota` switched to the live `/quota_status` endpoint** —
  returns daily/weekly/monthly windows for `llm_completion`, `ai_rescore`,
  `web_fetch` resources. Use this AFTER a 429 to explain which window was hit.
- **Error mapping changed: `429 → QUOTA_EXCEEDED`** (production behavior).
  Legacy 402 still maps to QUOTA_EXCEEDED for back-compat.
- **HTTP-response headers are now captured** and propagated through the error
  envelope's `_meta: {region, endpoint, latency_ms, retry_after}`. There is
  no `X-Request-Id` header on the Leadbay backend — we don't pretend there is.
- **`LEADBAY_MOCK=1`** mode: serve responses from on-disk fixtures
  (`.context/leadbay-live-shapes/`) for agent-author dry-running. Writes are
  journaled in-process and return `{mocked: true, would_call: {...}}`.
- **`dry_run: true`** param on every state-changing composite (`report_outreach`,
  `set_user_prompt`, `update_lens_filter`, `launch_bulk_enrichment`, etc.) —
  returns the would-call envelope without contacting the backend.

## report_outreach: verification REQUIRED

The autoplan review (CEO + Eng + DX voices) flagged that allowing the agent
to self-report outreach without proof would poison the SDR pipeline. The user
chose the strictest mitigation: every `report_outreach` call MUST include a
`verification` field:

```json
{
  "lead_id": "abc-123",
  "note": "Sent intro email to CTO citing Hornsea 3 contract",
  "epilogue_status": "STILL_CHASING",
  "verification": {
    "source": "gmail_message_id",
    "ref": "<the message id from Gmail>"
  }
}
```

Valid `source` values:
- `gmail_message_id` — message id returned by `mcp__claude_ai_Gmail__send_email`
- `calendar_event_id` — event id from a calendar booking tool
- `user_confirmed` — `ref` is the user's literal confirmation in chat

The verification is appended to the note body so humans in the Leadbay UI can
see the proof. Calls without verification return `VERIFICATION_REQUIRED`.

## Side-by-side: old flow → new flow

| Old (v0.1) | New (v0.2) | Notes |
|---|---|---|
| `leadbay_find_prospects` | `leadbay_pull_leads` | Same intent; richer return; remove name |
| `leadbay_get_lead_profile` | `leadbay_research_lead` | New ordering (qualification first); reshapes `web_fetch.content` from emoji-keyed dict to ordered array. Granular still available behind exposeGranular. |
| `leadbay_research_company` | unchanged | Kept for back-compat; prefer `research_lead` when you have the id. |
| `leadbay_qualify_lead` (single) | `leadbay_bulk_qualify_leads` | Composite paginates past already-qualified, fan-outs, polls, bails on 429. Granular still available. |
| `leadbay_enrich_contacts` (single) | `leadbay_enrich_titles` | Composite manages selection lifecycle. Granular still available. |
| `leadbay_get_quota` (legacy billing fields) | `leadbay_get_quota` (live /quota_status) | Same name, new shape. Old `freemium.daily_quota` / `ai_credits` are defunct. |
| Add a free-form note via `leadbay_add_note` | Log outreach via `leadbay_report_outreach` | Note tool still exists for free-form context; `report_outreach` is the right call after an actual action. |

## How to upgrade

### Claude Desktop / Cursor (MCP)

```json
{
  "mcpServers": {
    "leadbay": {
      "command": "npx",
      "args": ["-y", "@leadbay/mcp@0.2"],
      "env": {
        "LEADBAY_TOKEN": "lb_...",
        "LEADBAY_MCP_WRITE": "1"
      }
    }
  }
}
```

`LEADBAY_MCP_WRITE=1` opts in to write composites (the entire point of agent
flow — without it, the agent can read but not write). `LEADBAY_MCP_ADVANCED=1`
additionally exposes the granular tools; most users don't need it.

### OpenClaw plugin

In the plugin config (e.g. `openclaw config set plugins.entries.leadclaw.exposeWrite true`):

```json
{
  "region": "us",
  "exposeWrite": true,
  "exposeGranular": false
}
```

Default is read-only (exposeWrite=false, exposeGranular=false).

### What you might need to change in your prompts

- If your prompts reference `leadbay_find_prospects`, change to `leadbay_pull_leads`.
- If your prompts reference `leadbay_get_lead_profile` directly, prefer
  `leadbay_research_lead` for the agent-friendly shape.
- If your agent calls `leadbay_add_note` for outreach actions, switch to
  `leadbay_report_outreach` with `verification`.

## Out of scope for this release

- Per-tool semver versioning (the `Tool.version` field is in `types.ts` but
  individual tool files don't yet declare versions).
- A real `bulk_id` polling tool — the backend doesn't return one from `/launch`
  and there's no list endpoint (probed). Use `leadbay_get_contacts` per-lead
  to detect when `enrichment.done` flips.
- A `DELETE /lenses/{draftId}` endpoint — not testable in our tenant; treated
  as best-effort with `orphan_draft_id` surfaced on cleanup failure.
