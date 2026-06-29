---
name: leadbay_weekly_outreach_arc
description: "Run the full weekly outreach arc in one flow: pull up to 50 leads WITH contacts on the active lens, qualify, enrich the BUYER-PERSONA contacts (spend-gated), research, and produce ready-to-send Gmail drafts via `message_compose_v1` — then STOP for me to review and send. Trigger on \"run my weekly arc\", \"weekly outreach run\", \"find 50 leads and draft the emails\". DRAFT-ONLY: never sends, never calls `leadbay_report_outreach`. Schedule it weekly with `leadbay_schedule_weekly_arc`."
---


## MEMORY

Before responding, glance at any `_meta.agent_memory.summary` returned by tool calls earlier in this session and reflect its top signals in your reasoning ("Filtering by your stated preference for healthcare"). After any material new signal from the user this conversation (sector, region, deal size, communication style, qualification rule, explicit retraction, or recurrence / scheduling preference such as "I do this every day" or "remind me every morning"), call `leadbay_agent_memory_capture` to persist it: `source:"user_stated"` if literal, `source:"inferred"` with confidence <=6 if inferred.


Run my full weekly Leadbay outreach arc<the value derived from "count" (phrase). Source: Optional: how many leads to run the arc on. Default 50, capped at 50.>. <if the user supplied this argument, render the short block derived from it; otherwise empty. Source: Optional: a fresh audience to target (e.g. 'dental clinics in Texas'). Omit to run on my ACTIVE lens — the default.> Take it all the way to **ready-to-send Gmail drafts**, then stop so I can review and send them myself.

GATE — DEFER TO TOOL RENDERING. When you call a Leadbay composite that ships its own RENDERING block (every composite in 0.9.0+ does), render the response using that block's recipe verbatim — score bars, glyph palette, column order, hide-list, link priorities, all of it. Do NOT substitute prose, a numbered list, or a different column structure even when an orchestrating prompt's body suggests alternate framing. Prompt-specific commentary (motivational nudges, summaries, next-action recommendations) belongs ABOVE or BELOW the canonical table, never in place of it.

If the prompt's body and the tool's RENDERING appear to conflict, the tool's RENDERING wins for the structural layout; the prompt's voice wins for the commentary that surrounds it.


# Resilience rules for Leadbay long-running tools

These four rules apply to every Leadbay workflow that calls `leadbay_pull_leads`, `leadbay_bulk_qualify_leads`, `leadbay_research_lead_by_id`, `leadbay_import_and_qualify`, or `leadbay_enrich_titles`. **Treat timeouts and stream-closed errors as transient, not as signals to replan.**

## Rule 1 — Pin the lens

After your first `leadbay_pull_leads` call, capture `response.lens.id` into your working memory and **pass it explicitly as the `lensId` argument to every subsequent call** in this session — including any re-pulls, bulk qualifies, or research calls that accept it. (Field-name caveat: the response nests it as `lens.id`; the parameter on subsequent calls is `lensId`.) The active lens can shift between calls (5-minute client cache + backend `last_requested_lens` can change if the user touches the web UI). A lens shift mid-workflow throws away your top-10 work.

## Rule 2 — Prefer async for bulk operations

`leadbay_bulk_qualify_leads` and `leadbay_import_and_qualify` accept `wait_for_completion:false`, which returns `{status:'running', qualify_id}` immediately. Then poll `leadbay_qualify_status` (or `leadbay_import_status`) every ~10s until the job completes. **Use the async pattern by default** — the blocking default can exceed the MCP client's per-call timeout on large batches and produce a misleading `"Request timed out"` even though the server is still working.

## Rule 3 — Serialize `leadbay_research_lead_by_id` fan-out

`leadbay_research_lead_by_id` is composite and reads many sub-resources. Calling it on 10 leads in parallel can saturate the transport and produce `"Tool permission stream closed"` errors that look like permission failures but are really backpressure. **Call it sequentially**, or at most 3 in parallel. If one call fails with a stream/timeout error, retry that one call once before moving on; on a second failure, note the lead and continue — do not abandon the remaining leads.

## Rule 4 — Retry, don't replan

If a Leadbay tool returns `"Request timed out"`, `"stream closed"`, or any other transport-level error (distinct from a Leadbay-issued error payload), the work may still be running server-side. Do this in order:

1. For bulk tools — retry with `wait_for_completion:false` and poll the status tool with the returned id. Don't re-pull leads; that can shift the lens.
2. For single-lead tools — retry the same call once. If it still fails, record the lead id and continue with the rest of the workflow.
3. **Do not** switch strategies (e.g. "the endpoint is broken, let me re-pull from scratch"). The earlier work is still valid; the timeout was the wire.

If `pull_leads` itself fails and you have no prior batch, then yes — retry it, explicitly pass the lensId you captured (if any), and continue.


# PHASE 0 — RESUME CHECK

If you're resuming an interrupted run (you see an earlier phase already completed in your task list, or the user / scheduler says "continue"), do NOT restart from Phase 1. Re-read the active `lensId` and your last completed phase from prior context, then resume from the next phase. If you genuinely have no state, start at Phase 1. (A scheduled weekly run can be interrupted mid-arc — resuming, not restarting, is what keeps the cohort intact.)

# PHASE 1 — STATE + AUDIENCE

Call `leadbay_account_status` to see my remaining quota, my **enrichment credits**, and my **active lens**. Note `web_fetch_remaining` (qualification budget) and the enrichment credit balance — Phase 3 spends credits.

Resolve the audience:

- **Default — use my active lens.** If I didn't name a fresh audience, the active lens IS the audience. Do NOT create a new lens.
- **Fresh-audience fork.** Only if I described a NEW audience the active lens doesn't already cover, confirm once before switching, then continue on that lens. Do NOT silently overwrite my existing lens.

# PHASE 2 — DISCOVER (up to 50)

Call `leadbay_pull_leads({count:<requested, default 50, capped at 50>, lensId:<if known>})`. **Capture `response.lens.id` and pass it as an explicit `lensId` on every later call this session** — a mid-session lens shift would discard the cohort. Render the batch with the canonical layout:

## RENDERING — markdown table, three columns, score-bar driven

Present the response as a markdown table sorted by `score` descending, with exactly three columns. Do not summarize in prose. Do not show the numeric score anywhere.

## Score-bar (10-segment, inline-code wrapped)

Wrap a 10-glyph bar in a SINGLE inline-code span (backticks). The inline-code styling is what gives the bar contrast in most chat renderers — HTML `<span>` is stripped inside table cells.

Glyphs (use these exact characters; do not substitute):

- `▰` — firmographic-only fill
- `❖` — AI-booster cap (placed at the RIGHT END of the filled run, never the front)
- `▱` — empty

Computation:

```
total_filled  = round(score / 10), clamped to 0..10
ai_segments   = round(qualification_summary.avg_qualification_boost / 3.3),
                clamped to [0, total_filled]
normal_filled = total_filled − ai_segments
bar = "▰" × normal_filled
    + "❖" × ai_segments
    + "▱" × (10 − total_filled)
```

If `qualification_summary.answered == 0` or `avg_qualification_boost` is null, set `ai_segments = 0` (no ❖). Always wrap the bar in backticks. Print the legend `` `▰` firmographic · `❖` AI booster cap · `▱` unfilled `` once below the table.


**Column 1 — Company**

- Line 1: the 10-segment score bar in inline-code backticks (see the score-bar snippet above for the algorithm).
- Insert `<br>` between lines.
- Line 2: linked company name + ` · ` + short location + ` · ` + compact size.
  - Link target: `website` (prefix `https://` if it's a bare hostname). Don't synthesize an app deep-link.
  - Location: shorten "City of New York" → "NYC"; otherwise "City ST"; state alone only when city missing.
  - Size: `"Xk+"` when `size.min >= 1000`, `"min–max"` otherwise.

**Column 2 — Why it fits**

- One sentence, ≤ 20 words.
- Synthesize from (in priority order, whichever is present) the lead's `short_description`, top 2 `tags[].display_name`, and the gist of `qualification_summary.best_response_excerpt`. The trim payload does NOT carry the longer `description` field — for that, agent must call `leadbay_research_lead_by_id` or `leadbay_research_lead_by_name_fuzzy`.
- Do NOT append `(boost N)` — the ❖ cap in column 1 already carries that signal.
- No bullet lists, no line breaks inside the cell.

**Column 3 — Contact**

`[Contact name](LINK) · short job title`. The `[Contact name](LINK)` markdown link wrapping is mandatory — never render the name as plain text. See linking/contact-linkedin for the URL priority (real profile → constructed people-search) and the °-flag fallback.

**Hide from the user (never include in any cell):** `id`, `location.pos`, `location.country` (unless city/state both missing), `sector_id`, `is_hq`, `web_fetch_in_progress`, `enrichment_in_progress`, `highlighted_fields`, `custom_fields`, `contacts_count` when 0, `notes_count` / `epilogue_actions_count` / `prospecting_actions_count` when 0, `stale_at`, `deal_insights`, `social_presence` booleans (except as the °-flag signal), `need_attention` flags, any field whose value is the string `"null"`.

## Linking a contact's name

**MANDATORY: every contact name in your output — table cells, prose, headers, "Reach <Name>" callouts — MUST be wrapped in markdown link syntax `[Name](URL)`. Never render a contact name as bare text. A plain-text name is a broken contact card; the underlined name is the user's primary affordance for "take me to this person's profile". No "no URL available" exception — the search URL below is always constructable from name + company.**

URL priority (first applicable wins):

1. **Real profile** — `contact.linkedin_page` when it's a string starting with `https://` (the MCP coerces the legacy literal `"null"` string to real null before you see it).
2. **Constructed people-search** — `https://www.linkedin.com/search/results/people/?keywords=<First>+<Last>+<Company>`. URL-encode params. Strip Inc / LLC / Corp / Ltd / GmbH / Co / S.A. / S.L. / PLC / AG / SAS / SARL suffixes from the company. Append a trailing ` °` to the rendered name ONLY when this fallback is in use AND `social_presence.linkedin == false`. Never append `°` when a real `linkedin_page` was used.

Never link a person's name to the company's LinkedIn page (and vice versa) — the two surfaces are different and conflating them quietly degrades the workflow.

## Linking the company

Use the lead's `website` as the company-name link target — prefix `https://` if the value is a bare hostname. (The MCP does NOT synthesize a Leadbay-app deep-link URL; the team has not standardized one. Linking to `website` is always real data.)

When the response carries `social_urls` (the post-fix multi-platform URL block on rich-lead responses), render every non-null platform as a pill chip in the company-info row. Iterate over `social_urls`'s keys — never hardcode a fixed list — and emit each as `[<platform-label>](<url>)`. Skip platforms whose URL is null.

`social_presence` carries booleans for the same 6 platforms (crunchbase, facebook, instagram, linkedin, tiktok, twitter) — useful when you only care that the company has a profile somewhere. Use it as the °-flag signal in the contact people-search fallback (see linking/contact-linkedin).



If the batch is thin (fewer workable leads than requested), top it up: call `leadbay_bulk_qualify_leads({lensId:<captured>, count:<deficit, max 25>, wait_for_completion:false})`, capture `qualify_id`, poll `leadbay_qualify_status` every ~10s until `status:'done'`, then re-pull with the same `lensId`. Never re-pull without `lensId`.

Note the funnel out loud: the `count` is the **discovery target**, not a guaranteed draft count. The leads that actually get drafts are the buyer-covered subset locked in Phase 3 — be honest about the shrinkage ("pulled 50 → 38 have a reachable buyer → 38 drafts").

# PHASE 3 — ENRICH THE BUYER-PERSONA CONTACTS (load-bearing, paid gate)

This is the phase that earns the "50 leads WITH contacts" promise. Contacts aren't attached by default and enrichment is paid — so spend it ONLY on the people who would actually **buy what I sell**, not on whoever is most senior.

**Step A — work out MY buyer persona (before touching titles).** Infer my product / value-prop from my context — my org/account (`leadbay_account_status`) and especially my lens's `qualification_summary` (it tells you *why* these companies are good targets, which implies what I'm selling them). Map value-prop → the **buying department/persona, NOT seniority** (a sales/GTM tool → the revenue org: VP/Head/Director of Sales, BD, growth, marketing, RevOps; an ops tool → operations; a dev tool → engineering; Founder/CEO is a real buyer only at small companies ≤~50). State the persona in one line.

**ANTI-PATTERN — do NOT** pick the most senior or "decision-maker-sounding" title regardless of department. Seniority is not the same as being my buyer.

**Step B — find the persona-matching titles (discovery is a MENU, not a verdict).** Call `leadbay_recall_ordered_titles({leadIds, lensId})` and `leadbay_enrich_titles({leadIds, lensId})` in **discovery mode** (no `titles`). These return `available_titles`, `title_suggestions`, `auto_included_titles`, `enrichable_contacts`, and `credits_remaining`. Two things you MUST understand about this response:

- **Discovery `enrichable_contacts: 0` is EXPECTED and is NOT a stop signal.** Discovery runs a zero-titles preview, so the count is naturally 0 — it means "you haven't picked titles yet," not "nothing can be enriched." The real enrichable count only appears AFTER you choose titles and re-preview (Step C). Never abandon the arc on a discovery `0`.
- **`credits_remaining` is a display figure, not a gate.** It can read `0` or be unknown even when enrichment will succeed (the balance lags the real entitlement). Surface it for transparency, but a `0`/unknown reading MUST NOT stop you from selecting titles and launching. The launch result is the source of truth — only a real `quota_exceeded` / paid-rejection on the actual launch (Step D) means stop.

Pick the titles from `available_titles` / suggestions that match my buyer persona; ignore off-persona suggestions.

**Step B.5 — coverage guarantee.** Determine which leads have an **enrichable buyer-persona contact** by selecting your persona titles and reading the WITH-titles preview (Step C) — plus, where ambiguous, a quick `leadbay_research_lead_by_id` to see a lead's contact titles. KEEP leads with ≥1 enrichable buyer contact (the "WITH contacts" promise); drop leads whose only contacts are off-persona. If the lens genuinely can't supply enough buyer-ready leads, say so honestly rather than padding. State the funnel ("dropped 12 — no reachable buyer; 38 remain").

**Step C — pick titles, RE-PREVIEW, then SPEND GATE.** Call `leadbay_enrich_titles({leadIds, lensId, titles:[...persona titles]})` (titles set, no launch flags yet) to get the **real** `enrichable_contacts` for those titles. THIS number — not the discovery 0 — is what you gate on. Then state the persona, the chosen titles, and "This enriches {enrichable_contacts} <persona> contacts across {n} leads (credits shown: {credits_remaining})." Confirm via your host's choice widget — "Enrich these {enrichable_contacts} <persona> contacts now?" → ["Yes, enrich", "No — draft from existing contacts only", "Change the persona/titles"]. **Never launch without this confirm** — but the gate is about user CONSENT to spend, not about the displayed credit number.

> **Unattended (scheduled) runs:** when there is no interactive user to answer the gate — a scheduled weekly run — do NOT block forever and do NOT spend freely. Enrich only **within the pre-approved credit ceiling** carried in the run's instruction (the cap set at schedule time via `leadbay_schedule_weekly_arc`). If the persona enrichment would exceed that ceiling, SKIP enrichment and draft from already-available contacts. Never exceed the ceiling unattended.

**Step D — launch + poll.** On yes (or within the unattended ceiling): `leadbay_enrich_titles({leadIds, lensId, titles:[...chosen], email:true, phone:true})` to launch, then poll `leadbay_bulk_enrich_status` until done (can take several minutes — keep polling; do not draft empty). Only a real `quota_exceeded` / paid-rejection here is a true credit wall — if that happens, say so and draft from existing contacts. Append `_(N credits remaining)_` at the very end of your reply.

If enrichment is skipped (user declined, or a genuine launch-time quota wall), continue — draft from whatever contacts already exist.

# PHASE 4 — RESEARCH (serialized)

Call `leadbay_research_lead_by_id` on each buyer-covered lead. **Serialize — one at a time, or at most 3 in parallel.** Do not fire the whole cohort in parallel; it triggers transport backpressure (`"stream closed"`). If a call fails, retry that single lead once; if it fails again, note the lead id and continue. For each researched lead surface what makes it promising (cite a signal) and the **recommended contact** (name, title, why they're the right entry point).

# PHASE 5 — DRAFT (the deliverable)

For each buyer-covered lead, call `leadbay_prepare_outreach({leadId, lensId})` to get the brief + `recommended_contact` (post-enrichment, with email/phone), then render the draft.

## GATE — PREFER BUILT-IN HOST WIDGETS

Modern chat hosts (Claude, ChatGPT) expose first-party widgets the agent can route into. These ALWAYS produce a better UX than markdown tables / inline prose for the data shapes they support — they're tappable on mobile, persistent across turns, and integrate with the host's quick-actions.

**The Big Three** — when a tool result fits, route there:

| Host widget | Use when | Field map (from Leadbay payload) |
|---|---|---|
| `places_map_display_v0` (Claude) | Result has ≥2 leads with `location.city` set, and the user's intent is geographic / "in person" / travel | `{name: lead.company_name, address: "<city>, <country>", place_id: lead.location.place_id ?? omit, notes: <one-sentence pitch>}` per location |
| `message_compose_v1` (Claude) | You're about to draft outreach (email / message / call opener) | `{kind: "email", summary_title, variants: [{label, body, subject}]}` — 2–3 variants, labels describe STRATEGY ("Push for alignment", "Reference the M&A signal"), not tone ("Friendly", "Formal") |
| `ask_user_input_v0` (Claude chat / ChatGPT) **or** `AskUserQuestion` (Claude cowork / Claude Code) — whichever is in your tool set; their schemas differ, match the one you have | The tool's NEXT STEPS block has 2–4 mutually-exclusive next moves and the user hasn't already chosen | Per-tool schema in the server instructions + NEXT STEPS routing block. Max 3 questions. |

ChatGPT exposes the same routing pattern via `_meta.openai/outputTemplate`. We don't ship any custom widgets ourselves — this gate is exclusively about routing into the host's first-party widgets when the data shape fits.

**Rules:**
- The widget IS the visual. Do NOT emit a markdown table or prose list of the same data alongside — that produces two competing UIs.
- Pass identifiers (place_id, lead.id, contact_id) verbatim. Don't rewrite.
- When the host doesn't expose the named widget, the agent falls back to the prose/table rendering the per-tool description already specifies. The directive is host-conditional; the fallback is automatic.
- One short intro sentence in chat is enough — "Here are your 5 NYC follow-ups." Then route into the widget.


**Route each draft through `message_compose_v1`** (one composer per covered lead):

- `{kind: "email", summary_title: "<Company> — <Contact> (<persona title>)", variants: [{label, subject, body}]}` — **2–3 variants per lead**, where the `label` describes the **STRATEGY** ("Reference the funding signal", "Peer-intro angle", "Lead with the pain"), never the tone ("Friendly", "Formal").
- ABOVE each composer, ONE short markdown context line: score callout + sector fit + the LinkedIn-linked contact name + bare phone/email (those auto-linkify). Do NOT also paste the body into prose — the composer IS the draft.
- **Flag ⚠ suspect contacts**: any enriched contact whose email domain doesn't match the company website, or who appears on more than one lead in this batch. Keep the phone but tell me the email looks off.

## RENDERING — outreach brief (single-record card)

Present as the richest single-record card the MCP emits. The user is seconds-to-minutes away from contacting someone — every section earns its place by either (a) telling them HOW to outreach, (b) showing what they've done before, or (c) surfacing what's missing and how to get it.

**Async enrichment.** When `enrichment.triggered && !enrichment.complete`, do NOT block the user. Render the brief with `⏳` on un-enriched channels and IMMEDIATELY draft a first version of the outreach using whatever data IS available (`split_ai_summary.approach_angle`, company-line phone, LinkedIn-search fallback). Tell the user: *"I'll refresh once enriched data lands."* On their next message (or after a clear pause), re-call `leadbay_prepare_outreach(leadId)` without `enrich`; if `enrichment.complete: true`, surface the now-resolved channels and offer to revise the draft.

### Structure

**Header** (H5): `📞 Outreach prep — [Contact name](LinkedIn) · [Company](website)`

- Sub-line: job title · `+N more contacts` when `additional_contacts_count > 0`.
- Prefix `https://` to `website` if it's a bare hostname.

**Score line** (when `lead.score` is present): the 10-segment bar inline, no `<br>`. Same algorithm as `pull_leads`.

**Channel readiness** — a single line of pill chips, ` · `-separated:

- `🔗 LinkedIn` — `profile` (linked to real URL) if `linkedin_page` present; `search` (linked to people-search fallback) otherwise. `⏳` during enrichment.
- `📧 Email` — show address if present; `⏳ enriching` when `enrichment.triggered && !complete`; `⚪ not enriched` otherwise.
- `📞 Phone` — contact-specific number if present; fall back to `lead.phone_numbers[0]` with `(company line)` annotation; `⏳` / `⚪` otherwise.

**H5: 🎯 Angles & approach**

- Render `lead.split_ai_summary.approach_angle` as the lead-in.
- 3–4 bullets distilling `split_ai_summary.next_step` and any signals from a prior `research_lead_by_id` call into salesperson-voice talking points. Cite `[source](url)` inline when known.
- Final line: `Recommended channel: <X> — <rationale>`. Compute the recommendation from what data is available (email present → email; phone present → call; LinkedIn only → DM).

**H5: 📜 History with [Contact name]**

When prior contact-level actions / notes are surfaced (or when `prospecting_actions_count > 0`), render a reverse-chronological timeline: `<date> · <action_type> · <one-line summary>`. Quote-block recent notes below. If empty: `*No prior touchpoints with this contact.*`

**H5: 🏢 History with [Company name]**

Same shape as the contact history, but only include items NOT duplicated from the contact section. If both empty: `*No company-level history recorded.*`

**H5: 👥 Other contacts** (only if `additional_contacts_count > 0`)

One line: `+N more contacts at this company — [see them all](leadbay_research_lead_by_id)`.

**Closing line** (when enrichment is in progress): `*Enrichment running — I'll refresh once email/phone lands.*`

**Hide:** `id`, `lead.id`, raw `enrichment.hint` when redundant with channel pills, history items without descriptions, any field whose value is the string `"null"`, deprecated `other_contacts_count` (use `additional_contacts_count`).

## Linking a contact's name

**MANDATORY: every contact name in your output — table cells, prose, headers, "Reach <Name>" callouts — MUST be wrapped in markdown link syntax `[Name](URL)`. Never render a contact name as bare text. A plain-text name is a broken contact card; the underlined name is the user's primary affordance for "take me to this person's profile". No "no URL available" exception — the search URL below is always constructable from name + company.**

URL priority (first applicable wins):

1. **Real profile** — `contact.linkedin_page` when it's a string starting with `https://` (the MCP coerces the legacy literal `"null"` string to real null before you see it).
2. **Constructed people-search** — `https://www.linkedin.com/search/results/people/?keywords=<First>+<Last>+<Company>`. URL-encode params. Strip Inc / LLC / Corp / Ltd / GmbH / Co / S.A. / S.L. / PLC / AG / SAS / SARL suffixes from the company. Append a trailing ` °` to the rendered name ONLY when this fallback is in use AND `social_presence.linkedin == false`. Never append `°` when a real `linkedin_page` was used.

Never link a person's name to the company's LinkedIn page (and vice versa) — the two surfaces are different and conflating them quietly degrades the workflow.

## Linking the company

Use the lead's `website` as the company-name link target — prefix `https://` if the value is a bare hostname. (The MCP does NOT synthesize a Leadbay-app deep-link URL; the team has not standardized one. Linking to `website` is always real data.)

When the response carries `social_urls` (the post-fix multi-platform URL block on rich-lead responses), render every non-null platform as a pill chip in the company-info row. Iterate over `social_urls`'s keys — never hardcode a fixed list — and emit each as `[<platform-label>](<url>)`. Skip platforms whose URL is null.

`social_presence` carries booleans for the same 6 platforms (crunchbase, facebook, instagram, linkedin, tiktok, twitter) — useful when you only care that the company has a profile somewhere. Use it as the °-flag signal in the contact people-search fallback (see linking/contact-linkedin).



When the host doesn't expose `message_compose_v1`, fall back to the single-record brief card above — but the email subject + body must still be fully drafted and ready to copy.

# PHASE 6 — HANDOFF + STOP

# IRON LAW — DRAFT, DO NOT SEND

This flow deliberately **drafts** outreach — that is its job. It **stops at
drafts.** Composing into the host's `message_compose_v1` composer is *allowed*
and expected; **sending is not.**

- Do NOT send any email. Do NOT call `leadbay_report_outreach`. Do NOT write a
  draft body into any outbound / "send" tool argument.
- The drafts are left in the host composer for the user to **review, edit, and
  send manually** via their own Claude-connected Gmail (or other connector).
- Logging an outreach is a *separate, later* step that happens only AFTER the
  user actually sends — via `leadbay_log_outreach`, never here.

Sending is the user's call. Hand the drafts back and stop.


State the honest funnel one last time ("pulled 50 → 38 buyer-covered → 38 drafts ready") and `_(N credits remaining)_` if you enriched. Then offer, via your host's choice widget:

- "Review & send these in Gmail" — *you* do this manually; I won't send.
- "Refine a specific draft" — name the lead and I'll revise that composer.
- "Schedule this arc to run weekly" → routes to `leadbay_schedule_weekly_arc`.

**ALWAYS render NEXT STEPS via your host's next-step widget.** Use whichever is in your tool set — the NAME and SCHEMA differ: **`ask_user_input_v0`** (Claude chat / ChatGPT) takes plain-string options with `type:"single_select"`; **`AskUserQuestion`** (Claude cowork / Claude Code) takes object options `{label, description}` plus a required short `header` (≤12 chars) and `multiSelect`, NO `type` field, and never add an "Other" option (the host adds it). Match the schema to the tool you actually have — the wrong schema fails silently and you fall back to prose. Prose bullets are the fallback ONLY when NEITHER widget exists. Any turn that would end with a choice must be the widget — the widget IS the question.

**If the tool result carries a `next_steps` object, that is the source of truth — use it directly.** Each option has a short `.label` (≤5 words) and a full `.description`. Map `next_steps.options[]` into your host widget VERBATIM and in order: for `AskUserQuestion` (cowork / Claude Code) pass each as `{label, description}`; for `ask_user_input_v0` (Claude chat / ChatGPT, string options only) pass each option's `.description` as the string (it's the full sentence). Do NOT reword, reorder, drop, or prose-ify them — they're built deterministically by the server so the offer (incl. the artifact option at position 0) fires every time. Fall back to the table below only when there is NO `next_steps` field.

**One exception — skip the widget** when the user's original message contained a complete sequential instruction chain ("show me X and then do Y") AND all stated steps have been completed. In that case, end with STOP directly — the user stated their full plan and does not need a "what next?" prompt.
- Skip example: "Show me today's leads and then research the top one for me." → after research completes, emit STOP without the widget.
- Do NOT skip for: plain requests ("show me today's leads", "run my check-in"), recurring-language requests ("I do this every day"), or requests where only one action was stated.

Pick 2–4 rows from the (Observation, Suggest, Calls) table below most relevant to the response, then call your host's widget with ITS schema (per the schema rules above — wrong schema fails silently):
- `ask_user_input_v0`: `{questions:[{question,type:"single_select",options:["<Suggest 1>","<Suggest 2>"]}]}`
- `AskUserQuestion`: `{questions:[{question,header:"Next step",multiSelect:false,options:[{label:"<≤5 words>",description:"<Suggest 1>"}]}]}`

User picks → call the matching `Calls` tool. Constraints: 2–4 mutually-exclusive options, AskUserQuestion labels ≤5 words (full text in `description`), max 3 questions. Table stays internal; never recite it.

---



Render this acknowledgment VERBATIM as the last line of your message:

```
STOP — awaiting user decision. I will not take any further action until you tell me what to do next.
```

Do not propose a next action. Do not call any more tools. Hand control back to the user.


# Iron laws

- DRAFT, never SEND. Compose into `message_compose_v1`; do not send and do not call `leadbay_report_outreach`. Sending is the user's manual step in Gmail.
- Enrichment targets MY buyer persona (who buys what I sell), NEVER generic seniority.
- NEVER launch paid enrichment without naming the persona and getting a yes. But the gate is user CONSENT, not the displayed credit number: a discovery `enrichable_contacts:0` or `credits_remaining:0` is NOT a wall — pick persona titles, re-preview for the true count, and launch. Only a real `quota_exceeded` on the launch stops you. On unattended runs, never exceed the pre-approved credit ceiling.
- Carry the captured `lensId` on every call. Serialize research at ≤3 parallel.
- The deliverable is ready-to-send drafts for the buyer-covered cohort — not a research summary, not one sample draft. State the funnel honestly.
