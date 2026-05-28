<p align="center">
  <img src="logo.png" alt="LeadClaw" width="200">
</p>

<h1 align="center">LeadClaw</h1>
<p align="center">MCP server that gives your B2B outreach agent superpowers. LeadClaw lets your agent tap into Leadbay's rich knowledge base of companies, turning outreach activity from senseless spamming into meaningful connections.</p>
<p align="center">Ask your agent for new leads, and it will pull highly qualified companies that score well against your target profile and meet your qualification criteria.</p>
<p align="center">Everything is personalized—nothing to configure. Leadbay runs advanced AI agents on your website and leverages deep B2B sales expertise to optimize how leads are sourced for you.</p>
<p align="center">Tell your agent which leads you want it to prospect, connect your communication channels, and it will source contacts from Leadbay and handle outreach on your behalf. Enjoy the outreach you no longer have to do.
</p>

---

> **New to Leadbay?** [Create your account here](https://wow.leadbay.ai/?register=true) before installing.

## How Leadbay thinks (mental model for your agent)

- **Inbox, not a database.** Each day your user logs back in, a fresh batch of leads is delivered. Batch size is paced by how many leads the user has actually acted on recently — some workflows produce a big stream of smaller prospects, others a narrow stream of bigger ones. Pulling more won't produce more; acting on leads does.
- **Two scoring layers.** Every lead ships with a basic `score` (firmographic — already decent, usually correlates with AI). Roughly the top 10 of each batch are also AI-qualified (targeted web research + qualification questions → `ai_agent_lead_score`). Leads below the top 10 aren't worse — the system is saving resources. The agent can request deeper qualification (`leadbay_bulk_qualify_leads`) or contact enrichment (`leadbay_enrich_titles`) on any lead that looks worth it.
- **Daily rhythm.** The agent works best as a daily check-in: pull fresh leads, skim the auto-qualified top, deepen 1-3 promising ones, propose outreach, then log what actually got sent via `leadbay_report_outreach`. If your host supports scheduling, set up a daily run.

## Install

### Via MCP (Claude Desktop, Cursor, Cowork, any MCP client)

```bash
npx -y @leadbay/mcp@latest install --email you@yourcompany.com --region us
```

The installer auto-detects which MCP clients you have (Claude Desktop, Cursor, Claude Code), prompts you per-target, and writes the token into each client's config. Add `--no-write` to disable the composite write tools. Full per-client setup, env vars, troubleshooting, and a tour of the MCP primitives is in [`packages/mcp/README.md`](packages/mcp/README.md).

### Via the Claude Code plugin marketplace

```text
/plugin marketplace add leadbay/leadclaw
/plugin install leadbay@leadbay-leadclaw
```

This single install registers the MCP server **and** drops six auto-discovered skills (`leadbay_daily_check_in`, `leadbay_research_a_domain`, `leadbay_import_file`, `leadbay_log_outreach`, `leadbay_qualify_top_n`, `leadbay_refine_audience`) that auto-trigger on natural-language asks. Claude Code prompts for your Leadbay token + region through the plugin's `userConfig` — no separate `leadbay-mcp install` step needed.

### Don't have a Leadbay account?

[Register here](https://wow.leadbay.ai/?register=true) before installing.

## Workflows

The canonical inventory of what the MCP supports — supported / partial / planned / blocked-on-backend — is **[WORKFLOWS.md](WORKFLOWS.md)**. Use it to triage incoming asks: find the row that matches, or add a new one. A small audit asserts every cited tool/prompt and test path is real, so the table can't silently drift.

Quick taste of what's in there:

```
leadbay_pull_leads → leadbay_research_lead_by_id             # discover & research
leadbay_pull_followups → leadbay_followups_map → leadbay_prepare_outreach   # travel/geo follow-ups
leadbay_import_leads → leadbay_bulk_qualify_leads            # import & qualify
```

## Development

```bash
pnpm install
pnpm prompts:build   # .md.tmpl → generated TS
pnpm -r build        # compile everything
pnpm -r test         # must be green
pnpm -r typecheck    # must be green
```

See [`CLAUDE.md`](CLAUDE.md) for the full contributor guide: tool structure, test conventions, build pipeline, and how to add a new tool.

## Requirements

- Node.js 22+
- A [Leadbay account](https://wow.leadbay.ai/?register=true)
