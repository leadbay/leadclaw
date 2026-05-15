/**
 * Prompt catalog — registered slash-commands the user can invoke
 * directly via the MCP client (Claude Desktop, Cursor).
 *
 * Each prompt encodes a workflow chain that would otherwise require
 * the agent to reconstruct from scratch on every session. Per
 * MCP 2025-11-25 §Prompts, prompts are pull-based: the client lists
 * them, the user picks one, the client invokes prompts/get with
 * arguments, the rendered messages become the agent's input.
 *
 * Backwards-compat: clients without prompts capability ignore the
 * catalog entirely.
 */

import type {
  Prompt,
  PromptArgument,
  GetPromptResult,
  PromptMessage,
} from "@modelcontextprotocol/sdk/types.js";

interface CatalogEntry {
  name: string;
  description: string;
  arguments: PromptArgument[];
  // Render must produce a non-empty messages array per spec. The first
  // message is typically a `user` role with text content the agent
  // consumes as its instruction.
  render: (args: Record<string, string | undefined>) => PromptMessage[];
}

function userMessage(text: string): PromptMessage {
  return { role: "user", content: { type: "text", text } };
}

const CATALOG: CatalogEntry[] = [
  {
    name: "leadbay_daily_check_in",
    description:
      "Run the canonical daily check-in: see account state, pull fresh leads, and surface the most-promising one for review. The user's typical morning workflow.",
    arguments: [],
    render: () => [
      userMessage(
        "Run the Leadbay daily check-in for me:\n" +
          "1. Call leadbay_account_status to see what quota I have left and which lens is active.\n" +
          "2. Call leadbay_pull_leads to get today's fresh batch.\n" +
          "3. Show me the top 3 — by ai_agent_lead_score when present, otherwise by score. " +
          "For each, summarize qualification_summary in one sentence.\n" +
          "4. Recommend ONE lead to research deeply, and call leadbay_research_lead on it. " +
          "Tell me what makes it promising, what signals stand out, and what would be the right outreach move.\n" +
          "5. Stop. Wait for me to decide what to do next. Do not call leadbay_report_outreach unless I explicitly say so."
      ),
    ],
  },
  {
    name: "leadbay_research_a_domain",
    description:
      "Import a company by domain and run deep qualification + research in one pass. Use when a colleague mentions a name and you want everything Leadbay knows about it.",
    arguments: [
      {
        name: "domain",
        description:
          "The company's primary domain (e.g. 'acme.com'). Protocol/path are stripped.",
        required: true,
      },
    ],
    render: (args) => [
      userMessage(
        `Research the company with domain '${args.domain ?? "<missing>"}' for me using Leadbay:\n` +
          `1. Call leadbay_import_and_qualify with domains=[{domain:'${args.domain ?? ""}'}]. This imports the lead AND runs AI qualification.\n` +
          `2. When the import resolves, call leadbay_research_lead on the new leadId.\n` +
          `3. Summarize: who is this company, what's their fit (qualification answers), what signals stand out, and which contact would I email first. Be honest about uncertainty.`
      ),
    ],
  },
  {
    name: "leadbay_import_file",
    description:
      "Import a user-supplied CSV/file into Leadbay, resolve ambiguous rows, commit the reviewed mapping, and optionally qualify the imported leads.",
    arguments: [
      {
        name: "file",
        description:
          "Path or user-visible name of the CSV/file to import. If omitted, use the file the user attached or referenced.",
        required: false,
      },
      {
        name: "instruction",
        description:
          "Additional user goal, e.g. 'then qualify the leads', 'preserve owner phone as a custom field', or 'only import restaurants in Manhattan'.",
        required: false,
      },
    ],
    render: (args) => [
      userMessage(
        `Import the user's Leadbay file${args.file ? ` (${args.file})` : ""} and satisfy this instruction: ${args.instruction ?? "import the rows, resolve identities, and qualify leads if the user asked for qualification"}.\n\n` +
          "Workflow:\n" +
          "1. Read the file yourself. Inspect every header, sample values from multiple rows, row count, duplicate/blank columns, and obvious dirty data. Build a column preservation plan before importing: for each meaningful column decide standard field, CONTACT_* field, Leadbay note, custom field, derived helper, or skip with a reason. Default to preserving client-provided business data; skip only blank placeholders, duplicate plumbing, raw unparsed blobs after extracting their useful values, or values that would actively harm data quality.\n" +
          "2. Build semantic helper columns before resolving. If there is no company website but a contact email uses a real business domain, derive a company_domain/company_website column from it only when that domain agrees with the company/deal/brand context. Ignore consumer mailbox domains such as gmail.com, hotmail.com, outlook.com, yahoo.com, icloud.com, proton.me/protonmail.com, aol.com, live.com, msn.com, me.com, gmx.*, and similar personal email providers. Also ignore POS/vendor/group domains that conflict with the company. Keep the original email for CONTACT_EMAIL.\n" +
          "3. Decide resolver identity_mappings from the actual file semantics. Prefer: website/domain/url or vetted derived business email domain -> website; cleaned company/account/restaurant/establishment name -> name; CRM/system id -> crm_id; registry/SIREN/SIRET/company number -> registry_number; full address/city/postcode/country/phone/email/socials when present. For HubSpot/deal exports, clean campaign suffixes like BYOC, BYOC only, DD, Uber, trailing separators, and duplicate pipeline labels before using the value as LEAD_NAME. If a column is ambiguous, inspect row values before mapping it. Do not rely on fixed header names.\n" +
          "4. Call leadbay_resolve_import_rows with representative or all rows and your explicit identity_mappings. For large files, batch rows so responses stay readable. Use include_candidate_profiles=true for small batches or rerun it on ambiguous rows only. If a row is ambiguous and candidate profiles are missing or truncated, rerun just those rows with include_candidate_profiles=true and a larger candidate_profile_limit before deciding.\n" +
          "5. Disambiguate relentlessly and keep a decision log. Use matched lead_id values directly. For ambiguous candidates, first make sure you have enough evidence: rerun the ambiguous rows with include_candidate_profiles=true and a larger candidate_profile_limit if profiles are truncated, and include every trustworthy source signal available (website, full address, postcode, city, phone, registry/CRM id, source URL path, neighborhood/location words). Compare addresses intelligently as a human would: recognize ordinary formatting, abbreviation, spelling, punctuation, casing, direction, ordinal, and suite/unit differences without reducing the decision to rigid rules. Write LEADBAY_ID when candidate facts uniquely agree with strong source evidence: exact registry/CRM id, exact phone, exact canonical website/domain with only one candidate, or name plus clear same-place address match with postcode/city and no conflict. If several candidates share the same website/domain, treat it as a chain/multi-location problem and use street address, postcode, city/neighborhood, phone, source URL path/location slug, and location words in the source name to pick the specific place when exactly one candidate matches. Never choose from score alone, name-only, fuzzy-name-only, generic directory websites, root-domain-only, brand-only, postcode-only, or city-only evidence. Leave LEADBAY_ID blank only after those checks still leave real ambiguity, and record why.\n" +
          "6. Build a clean records array for import from the preservation plan. Preserve user-requested and semantically meaningful business fields, add LEADBAY_ID where resolved, normalize obvious scalar fields, and split JSON/list blobs into useful scalar columns when they contain real business data. For meaningful columns with no standard Leadbay field, call leadbay_list_mappable_fields and create/reuse custom fields rather than dropping the data. Drop blank-header columns and placeholder values like `couldn't find`, `yes`, empty arrays, and raw JSON after useful values have been extracted. Do not preserve scraper plumbing, duplicate blank columns, or long reasoning text, but do preserve meaningful client notes, data-quality warnings that affect outreach, source record links, and evidence URLs when they help the user's workflow.\n" +
          "7. Treat contact exports and embedded owner/contact data as lead+contact imports. Map the parent company identity columns (LEADBAY_ID/LEAD_WEBSITE/LEAD_NAME/CRM_ID/SIREN) and also map person columns to CONTACT_FIRST_NAME, CONTACT_LAST_NAME, CONTACT_EMAIL, CONTACT_PHONE_NUMBER, CONTACT_TITLE, CONTACT_LINKEDIN. If a restaurant/company row contains structured owners, decision makers, or contact lists, expand those people into additional import rows that repeat the parent lead identity and contain one CONTACT_* person per row. Multiple rows may share the same LEADBAY_ID/company; import each row as a contact for that lead.\n" +
          "8. Preserve valuable HubSpot record links and source evidence. If HubSpot URL/id or source URL columns exist, call leadbay_list_mappable_fields. If no suitable field exists, call leadbay_create_custom_field. Prefer EXTERNAL_ID with config.url_template like https://app.hubspot.com/contacts/<portal-id>/record/0-1/{value} and import the stable object id; if an existing HubSpot linked-id field exists, reuse it for the HubSpot URL/id. Preserve raw source identifiers such as hubspot_id and associated_deal in custom fields when they are not already represented by a better standard/custom field. If only a full URL exists and no stable id/template can be recovered, create/use a TEXT custom field for the URL. Leadbay has CONTACT_PHONE_NUMBER but no standard LEAD_PHONE in this tool surface; preserve establishment/company phone only via an intentional custom field.\n" +
          "9. Preserve notes intentionally. If the file contains meaningful per-lead notes/context that should live as Leadbay notes, keep them aside during import and, after the import returns lead IDs, call leadbay_add_note for the relevant imported/resolved leads when that tool is available. For dry runs, report which notes would be written. If lead notes are not available and the user asked to preserve the text, create/reuse an import-notes custom field instead of dropping it.\n" +
          "10. Build the final mappings yourself. Start from leadbay_resolve_import_rows.mappings_for_import, then map semantically: LEADBAY_ID, LEAD_WEBSITE, LEAD_NAME, CRM_ID, SIREN, LEAD_LOCATION*, LEAD_SECTOR, LEAD_SIZE, contact fields, and useful CUSTOM.<id> fields. Call leadbay_list_mappable_fields before using custom fields.\n" +
          "11. Prefer leadbay_import_and_qualify when the user asks to qualify/research after import; otherwise use leadbay_import_leads. For large files or short client timeouts, pass wait_for_completion=false and poll leadbay_import_status. After import, qualify only lead IDs returned by the import; late website matches may appear later via import_status.\n" +
          "12. Report counts clearly: rows read, rows skipped, deterministic matches, ambiguous left unresolved, contacts imported, notes written or staged, custom fields created/reused, import IDs/handle IDs, leads imported now, and what will need later polling."
      ),
    ],
  },
  {
    name: "leadbay_refine_audience",
    description:
      "Refine the kind of leads Leadbay surfaces beyond firmographics, with a free-text instruction. Handles the clarification round-trip if the new prompt is ambiguous.",
    arguments: [
      {
        name: "instruction",
        description:
          "The refinement (e.g. 'focus on hospitals running their own IT'). Set to plain English.",
        required: true,
      },
    ],
    render: (args) => [
      userMessage(
        `Refine the Leadbay audience prompt to: ${args.instruction ?? "<missing>"}\n\n` +
          `1. Call leadbay_refine_prompt with prompt=<the instruction above>.\n` +
          `2. If the response includes a 'clarification' block, surface the question + options to me VERBATIM and wait. Do NOT call leadbay_answer_clarification on my behalf — I want to choose.\n` +
          `3. If the response status is 'applied', tell me Leadbay is regenerating intelligence and recommend I check back in a few minutes via leadbay_account_status (computing_intelligence flips to false when ready).`
      ),
    ],
  },
  {
    name: "leadbay_log_outreach",
    description:
      "Log outreach (an email I sent, a call I made, a meeting I had) on a specific lead. Captures verification so the SDR pipeline trusts the entry.",
    arguments: [
      {
        name: "lead_id",
        description: "The lead UUID. Get it from leadbay_pull_leads or leadbay_research_lead.",
        required: true,
      },
      {
        name: "summary",
        description:
          "1-2 sentences describing what I did (e.g. 'Sent intro email to CTO citing recent Hornsea contract').",
        required: true,
      },
    ],
    render: (args) => [
      userMessage(
        `Log this outreach on Leadbay lead ${args.lead_id ?? "<missing>"}:\n` +
          `Summary: ${args.summary ?? "<missing>"}\n\n` +
          `Before calling leadbay_report_outreach, ask me ONCE for verification:\n` +
          `- If I sent an email: ask for the Gmail message id (verification.source = 'gmail_message_id').\n` +
          `- If I booked a meeting: ask for the calendar event id (verification.source = 'calendar_event_id').\n` +
          `- Otherwise: ask me for a literal one-sentence confirmation that the outreach happened (verification.source = 'user_confirmed', verification.ref = my exact words).\n\n` +
          `After I answer, call leadbay_report_outreach({lead_id, note: <summary>, verification: {source, ref}}). Optionally pass dry_run:true first to confirm what would be sent.`
      ),
    ],
  },
  {
    name: "leadbay_qualify_top_n",
    description:
      "Bulk-qualify the top N un-qualified leads in the active lens. Uses leadbay_bulk_qualify_leads with a sensible default budget.",
    arguments: [
      {
        name: "count",
        description:
          "How many leads to qualify (default 10, max 25). Higher counts may take 5+ minutes.",
        required: false,
      },
    ],
    render: (args) => {
      const n = args.count ?? "10";
      return [
        userMessage(
          `Qualify the top ${n} un-qualified leads in the active Leadbay lens:\n` +
            `1. Call leadbay_bulk_qualify_leads with count=${n}.\n` +
            `2. While it polls, expect notifications/progress events showing per-lead transitions.\n` +
            `3. When it returns, summarize: how many qualified, how many still running, and the 3 highest-boost-score leads with their qualification_summary.\n` +
            `4. Recommend the single most promising lead and offer to research it deeply with leadbay_research_lead.`
        ),
      ];
    },
  },
];

export function listPrompts(): Prompt[] {
  return CATALOG.map((c) => ({
    name: c.name,
    description: c.description,
    arguments: c.arguments,
  }));
}

export function getPrompt(
  name: string,
  args: Record<string, string | undefined> = {}
): GetPromptResult {
  const entry = CATALOG.find((c) => c.name === name);
  if (!entry) {
    throw new Error(`Unknown prompt: ${name}`);
  }
  // Validate required arguments. Per spec, missing required args should
  // surface as a JSON-RPC error so the client can re-prompt the user.
  const missing = entry.arguments
    .filter((a) => a.required && (args[a.name] === undefined || args[a.name] === ""))
    .map((a) => a.name);
  if (missing.length > 0) {
    throw new Error(
      `Missing required prompt arguments: ${missing.join(", ")}`
    );
  }
  return {
    description: entry.description,
    messages: entry.render(args),
  };
}
