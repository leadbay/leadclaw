# @leadbay/leadclaw — Leadbay OpenClaw plugin

An OpenClaw plugin that gives any OpenClaw-compatible agent a first-class, 50-tool surface for Leadbay B2B lead discovery, qualification, and enrichment — backed by the same composite-workflow API used by [`@leadbay/mcp`](https://www.npmjs.com/package/@leadbay/mcp).

**Don't have a Leadbay account?** [Register here](https://wow.leadbay.ai/?register=true).

## 1. Install

### Via ClawHub (recommended)

```bash
clawhub package install @leadbay/leadclaw
```

### Via OpenClaw CLI (alternative)

```bash
openclaw plugins install @leadbay/leadclaw
```

### Via npm (for custom wiring)

```bash
npm install @leadbay/leadclaw
```

The npm tarball contains the bundled `dist/index.js`, the `openclaw.plugin.json` manifest, this README, the license, and the plugin logo. `@leadbay/core` is bundled in — no runtime deps besides Node ≥22.

## 2. Configuration

Set these in your OpenClaw plugin config block (names match the `uiHints` and `configSchema` in `openclaw.plugin.json`):

| Field | Required | Default | Purpose |
|-------|----------|---------|---------|
| `region` | **yes** (recommended) | (auto) | `"us"` or `"fr"` — pins which Leadbay backend receives your token. Strongly recommended to set explicitly; otherwise login auto-probes both regions. |
| `token` | optional | — | Pre-minted bearer token. If unset, the agent can call `leadbay_login` to mint one interactively. |
| `baseUrl` | optional | derived from region | Override API base (staging/dev). |
| `exposeGranular` | optional | `false` | Set `true` to also expose the ~30 low-level 1:1-with-API tools alongside the composite workflow tools. More surface area, more chance the agent picks the wrong one. |
| `exposeWrite` | optional | `false` | Set `true` to expose write/mutation tools (create lenses, enrich contacts, adjust audience, report outreach, etc.). Hidden by default so an LLM cannot mutate state without explicit opt-in. |

Example OpenClaw config fragment:

```jsonc
{
  "plugins": {
    "@leadbay/leadclaw": {
      "region": "us",
      "token": "lb_...",
      "exposeWrite": false,
      "exposeGranular": false
    }
  }
}
```

## 3. Tool surface

The plugin ships **50 tools**. Exposure is gated by the two flags above:

- **Default (composite workflow tools)** — the agent-facing surface. Read-only end-to-end: `leadbay_pull_leads`, `leadbay_research_lead_by_id`, `leadbay_research_lead_by_name_fuzzy`, `leadbay_prepare_outreach`, `leadbay_account_status`, `leadbay_recall_ordered_titles`, `leadbay_bulk_qualify_leads`, `leadbay_enrich_titles`, plus the login tool.
- **`exposeGranular: true`** — adds the granular API tools: lens read/filter/scoring, sector taxonomy, selection ids, enrichment job titles, contacts, quota, taste profile, user_prompt, clarifications, epilogue responses, prospecting actions, lead notes, web_fetch, etc. (23 tools.)
- **`exposeWrite: true`** — adds the write tools: `leadbay_create_lens`, `leadbay_update_lens`, `leadbay_set_active_lens`, `leadbay_set_user_prompt`, `leadbay_qualify_lead`, `leadbay_enrich_contacts`, `leadbay_add_note`, `leadbay_select_leads` / `leadbay_deselect_leads` / `leadbay_clear_selection`, `leadbay_refine_prompt`, `leadbay_report_outreach`, `leadbay_adjust_audience`, `leadbay_launch_bulk_enrichment`, etc. (17 tools.)

Write tools follow a **verification-first** contract where relevant — `leadbay_report_outreach`, for example, requires `gmail_message_id | calendar_event_id | user_confirmed` on every call so an agent cannot silently poison your pipeline with hallucinated outreach.

The canonical tool list + schemas live in [`openclaw.plugin.json`](./openclaw.plugin.json).

## 4. Example agent prompts

> *Find 20 SaaS companies in Berlin matching my Ideal Buyer Profile, research the top 3, and prepare an outreach package for the best-fit contact.*

> *Qualify the leads I selected last session, then recall the titles we've ordered so I can plan enrichment.*

> *Adjust my audience to include VP of Finance at Series B startups and refine the prompt if any clarifications come up.* (requires `exposeWrite: true`)

## 5. Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Plugin loads but agent sees no Leadbay tools | `token` missing and no login step taken | Have the agent call `leadbay_login`, or pre-set `token` in the plugin config |
| `Authentication token expired or invalid` | Token revoked or wrong region | Have the agent call `leadbay_login` to mint a fresh token; verify `region` matches your account |
| `No enrichment credits remaining` | Out of quota | Contact Leadbay support to extend quota |
| Agent keeps picking granular tools over composites | `exposeGranular: true` set | Flip to `false`; the composites are usually what you want |
| Write tool "not found" | `exposeWrite: false` (default) | Set `exposeWrite: true` after explicitly opting in |

## 6. Security & privacy

- Tokens live only in your OpenClaw plugin config; they traverse the network only to `api-{region}.leadbay.app`.
- Write tools (`exposeWrite`) and granular tools (`exposeGranular`) are **hidden by default** — opt-in per session.
- `leadbay_report_outreach` requires verification metadata (Gmail/Calendar id or explicit `user_confirmed` text) to prevent pipeline poisoning.
- No telemetry is sent by this plugin. API requests are subject to the [Leadbay privacy policy](https://leadbay.ai/privacy).

## 7. License

MIT. See [LICENSE](./LICENSE).
