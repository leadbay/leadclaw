# Migration: leadbay-mcp 0.2.x → 0.3.0

This release fixes [product#3504](https://github.com/leadbay/product/issues/3504): the default-installed MCP server's system prompt told the agent to call tools that the server didn't actually expose. Three behavior changes you need to know about.

## 1. `LEADBAY_MCP_WRITE` defaults to ON

In 0.2.x the composite write tools (`leadbay_bulk_qualify_leads`, `leadbay_enrich_titles`, `leadbay_refine_prompt`, `leadbay_report_outreach`, `leadbay_adjust_audience`, `leadbay_answer_clarification`, `leadbay_import_leads`) were gated behind `LEADBAY_MCP_WRITE=1`. The `SERVER_INSTRUCTIONS` referenced them anyway → users got an agent system prompt that lied about what was available.

**0.3.0**: `LEADBAY_MCP_WRITE` defaults to `"1"` (ON). The system prompt is built from the actual exposed tool set, so it stops lying. To restore the previous read-only behavior, set `LEADBAY_MCP_WRITE=0` (or `--no-write` on `leadbay-mcp install`).

### Value-vocabulary flip

In 0.2.x the parser was strict: only `LEADBAY_MCP_WRITE === "1"` turned writes on. So `=true`, `=yes`, `=on` were treated as OFF (probably accidentally — the user clearly meant "on"). The 0.3.0 parser accepts all of these as ON:

| Value | 0.2.x meaning | 0.3.0 meaning |
|---|---|---|
| unset | OFF | **ON** |
| `""` | OFF | **ON** |
| `"1"` / `"true"` / `"yes"` / `"on"` | OFF (only `"1"`) / OFF (the rest) | **ON** |
| `"0"` / `"false"` / `"no"` / `"off"` | OFF | OFF |
| anything else | OFF | ON + stderr warning |

If you were relying on `LEADBAY_MCP_WRITE=true` to mean OFF (unlikely but possible), switch to `LEADBAY_MCP_WRITE=0`.

## 2. `leadbay-mcp login` no longer prints the token to stdout

In 0.2.x `login` printed the bearer token (inside an MCP-config JSON blob) to stdout by default, with a stderr warning. Real users (Ludo's incident) had tokens leak into terminal scrollback / agent chat / CI logs.

**0.3.0**: `login` writes a `0600`-mode credentials file by default. The path resolves per-platform:

| Platform | Default path |
|---|---|
| Linux (or anywhere `XDG_CONFIG_HOME` is set) | `$XDG_CONFIG_HOME/leadbay/credentials.json` (or `~/.config/leadbay/credentials.json`) |
| macOS | `~/Library/Application Support/leadbay/credentials.json` |
| Windows | `%APPDATA%\leadbay\credentials.json` |

If `~/.leadbay-mcp.json` (the 0.2.x default) already exists, `login` writes to that path with a one-shot deprecation note pointing at the new location.

### `--unsafe-print-token` (legacy CI use)

Pass `--unsafe-print-token` to restore the old "print to stdout" behavior. The deprecated `--print-token` alias still works for one release with a warning. Use only if you have to — the token will end up in scrollback / logs.

### Collision detection

If the target file already exists with a different `LEADBAY_TOKEN` or `LEADBAY_REGION`, `login` refuses without `--force` and tells you how to keep both files. Toggling between accounts no longer silently overwrites the prior token.

### File-write errors

`EACCES` / `EROFS` / `ENOENT` print actionable remediation pointing at `--write-config /tmp/...` or `--unsafe-print-token`.

## 3. `leadbay-mcp install` registers Claude Code at `--scope user`

Previously `claude mcp add leadbay …` defaulted to project-local scope, so opening Claude Code from a different directory made Leadbay invisible. Ludo's #3504 third complaint.

**0.3.0**: `install` injects `--scope user` into the `claude mcp add` argv. New installs are visible from any project.

If you have a 0.2.x project-scope install and want to upgrade to user scope, run:
```bash
claude mcp remove leadbay
npx -y @leadbay/mcp@0.3 install --email you@yourcompany.com --region us
```
Or do it manually:
```bash
claude mcp add leadbay --scope user --env LEADBAY_TOKEN=<token> --env LEADBAY_REGION=us -- npx -y @leadbay/mcp@0.3
```

## 4. `--include-write` is a no-op

The legacy `leadbay-mcp install --include-write` flag is accepted but a no-op — writes are on by default in 0.3.0. The deprecation warning prints **before** the password prompt so users see it.

---

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
