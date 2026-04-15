<p align="center">
  <img src="logo.png" alt="LeadClaw" width="200">
</p>

<h1 align="center">LeadClaw</h1>

<p align="center">
  OpenClaw plugin that connects AI agents to <a href="https://leadbay.ai">Leadbay</a> for lead discovery, qualification, and contact enrichment.
</p>

---

> **New to Leadbay?** [Create your account here](https://wow.leadbay.ai/?register=true) before installing the plugin.

## Install

```bash
openclaw plugins install leadclaw
```

## Setup

The plugin prompts for your Leadbay credentials on first use:

1. **Region** — set `leadbay.region` to `us` or `fr` depending on your account
2. **Login** — enter your Leadbay email and password when prompted
3. The plugin authenticates once, stores only the API token, and discards your credentials

To re-authenticate (e.g., after a token expires):

```bash
openclaw config delete leadbay.token
```

## Tools

### Read-only (enabled by default)

| Tool | Description |
|------|-------------|
| `leadbay_list_lenses` | List available lenses (saved search configs) |
| `leadbay_discover_leads` | Get AI-recommended leads from your active lens |
| `leadbay_get_lead_profile` | Full lead profile with AI scores, qualification Q&A, and contacts |
| `leadbay_get_contacts` | Get contacts for a lead (with enriched emails/phones if available) |
| `leadbay_get_quota` | Check your enrichment credit balance |

### Write actions (must be explicitly enabled)

| Tool | Description |
|------|-------------|
| `leadbay_qualify_lead` | Trigger AI qualification on a lead (~60s async) |
| `leadbay_enrich_contacts` | Order email/phone enrichment for a contact (~60s async) |
| `leadbay_add_note` | Add a note to a lead (visible to your team) |

## How it works

The plugin automatically uses your **active lens** (the last lens you used in Leadbay). Just call `leadbay_discover_leads` and it works — no lens configuration needed.

For lead profiles, `leadbay_get_lead_profile` bundles three API calls (lead details + AI qualification + contacts) into a single response. If some data isn't available yet, it returns partial results instead of failing.

## Example workflows

**Discover and research leads:**
```
leadbay_discover_leads → leadbay_get_lead_profile (for interesting leads)
```

**Get contact information:**
```
leadbay_get_quota → leadbay_get_contacts → leadbay_enrich_contacts → (wait ~60s) → leadbay_get_contacts
```

**Qualify leads without AI scores:**
```
leadbay_discover_leads → leadbay_qualify_lead (for unscored leads) → (wait ~60s) → leadbay_get_lead_profile
```

## Configuration

| Key | Required | Description |
|-----|----------|-------------|
| `leadbay.region` | Yes | `us` or `fr` |
| `leadbay.token` | Auto | Set automatically after login |
| `leadbay.baseUrl` | No | Override API URL (for staging/dev) |

## Requirements

- Node.js 22+
- A [Leadbay account](https://wow.leadbay.ai/?register=true)
