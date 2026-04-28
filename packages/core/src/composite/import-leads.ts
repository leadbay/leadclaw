import { randomUUID } from "node:crypto";
import type { LeadbayClient } from "../client.js";
import type {
  Tool,
  ToolContext,
  RequestMeta,
  FileImportPayloadV15,
  ImportRecordPayload,
  PaginatedResponse,
  MappingsPayload,
} from "../types.js";

interface DomainInput {
  domain: string;
  name?: string;
}

interface ImportLeadsParams {
  domains: DomainInput[];
  dry_run?: boolean;
  per_phase_budget_ms?: number;
  total_budget_ms?: number;
}

type NotImportedReason =
  | "malformed"
  | "no_match"
  | "uncrawled"
  | "ambiguous"
  | "internal_error"
  | "dry_run";

interface ImportLeadsResult {
  leads: Array<{ domain: string; leadId: string; name: string | null }>;
  not_imported: Array<{ domain: string; reason: NotImportedReason }>;
  importIds: string[];
  region: "us" | "fr" | "custom";
  cancelled?: boolean;
  dry_run?: boolean;
  _meta: RequestMeta;
}

const CHUNK_SIZE = 100;
const POLL_INTERVAL_MS = 2_000;
const DEFAULT_PER_PHASE_BUDGET_MS = 60_000;
const DEFAULT_TOTAL_BUDGET_MS = 300_000;
const STABILIZATION_POLLS = 2;

// Public mailbox / generic domains. We do NOT denylist these (per user
// decision in /autoplan CEO phase). The list lives here so the reconciler
// can label `no_match` records that are mailbox-y as `no_match`, while
// genuinely unknown company domains get `uncrawled`. This is a *labeling*
// distinction, not a *gating* one — the wizard sees every domain.
const PUBLIC_MAILBOX_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "tutanota.com",
  "gmx.com",
  "gmx.net",
  "gmx.de",
  "mail.com",
  "yandex.com",
  "yandex.ru",
  "qq.com",
  "163.com",
  "126.com",
]);

// Strip protocol/path/trailing slash; lowercase. Returns null for clearly
// malformed input. The TLD shape check is intentionally loose — Leadbay
// supports unusual TLDs (.io, .ai, .gov.uk, etc.) so we only require: at
// least one dot, at least 2 chars on each side of the rightmost dot, no
// whitespace, no scheme leftovers.
export function normalizeDomain(input: string): string | null {
  if (!input || typeof input !== "string") return null;
  let v = input.trim().toLowerCase();
  if (!v) return null;
  // Strip protocol.
  v = v.replace(/^https?:\/\//, "");
  // Strip leading "www."
  v = v.replace(/^www\./, "");
  // Strip path/query/fragment.
  v = v.split("/")[0].split("?")[0].split("#")[0];
  // Strip trailing dot.
  v = v.replace(/\.+$/, "");
  if (!v) return null;
  if (/\s/.test(v)) return null;
  // Reject local/internal-style hosts: "localhost", bare hostnames, IPs.
  if (!v.includes(".")) return null;
  // Reject obvious nonsense: "..", ".com", ".tld" patterns.
  if (v.startsWith(".") || v.endsWith(".")) return null;
  const parts = v.split(".");
  if (parts.length < 2) return null;
  if (parts.some((p) => p.length === 0)) return null;
  // TLD must look like a TLD (≥2 alpha chars; supports punycode "xn--").
  const tld = parts[parts.length - 1];
  if (!/^[a-z]{2,}$/.test(tld) && !tld.startsWith("xn--")) return null;
  // SLD must be non-empty alphanumeric.
  if (!/^[a-z0-9-]+$/.test(parts[parts.length - 2])) return null;
  return v;
}

// CSV cell escaping: RFC 4180 + formula-injection guard.
// Spreadsheet apps trim/strip leading whitespace before parsing the first
// character, so " =HYPERLINK(...)" or "\n=..." is just as exploitable as
// "=HYPERLINK(...)". Strip leading whitespace before the first-char check,
// then prefix a single-quote if the first non-whitespace char triggers.
// Wrap in "..." if the cell contains , or " or \n or \r and double any
// inner quotes.
export function escapeCsvCell(raw: string): string {
  if (raw == null) return "";
  let s = String(raw);
  const trimmed = s.replace(/^[\s\r\n\t]+/, "");
  if (trimmed.length > 0) {
    const first = trimmed[0];
    if (first === "=" || first === "+" || first === "-" || first === "@") {
      s = "'" + s;
    }
  }
  if (/[",\n\r]/.test(s)) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

interface CsvRow {
  rowId: string;
  name: string;
  website: string;
}

export function synthesizeCsv(rows: CsvRow[]): string {
  const lines = ["MCP_ROW_ID,LEAD_NAME,LEAD_WEBSITE"];
  for (const r of rows) {
    lines.push(
      [escapeCsvCell(r.rowId), escapeCsvCell(r.name), escapeCsvCell(r.website)].join(",")
    );
  }
  return lines.join("\n") + "\n";
}

function chunkAt100<T>(items: T[]): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    chunks.push(items.slice(i, i + CHUNK_SIZE));
  }
  return chunks;
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw Object.assign(new Error("aborted"), { name: "AbortError" });
  }
}

async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await new Promise<void>((r) => setTimeout(r, ms));
    return;
  }
  if (signal.aborted) {
    checkAborted(signal);
  }
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      signal.removeEventListener("abort", onAbort);
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// Pull a column value by name (case-insensitive) from a record's records[]
// array. Live wire format (probed 2026-04-28): each entry is
// { column_name, value, field? }. Some test mocks use the older
// { cells: { ColumnName: value } } shape; tolerate both.
function readCell(record: ImportRecordPayload, key: string): string | null {
  const want = key.toLowerCase();
  const arr: any = (record as any).records;
  if (Array.isArray(arr)) {
    for (const c of arr) {
      const k = (c?.column_name ?? c?.key ?? c?.field ?? "").toString().toLowerCase();
      if (k === want) {
        const v = c?.value ?? null;
        return v != null ? String(v) : null;
      }
    }
  }
  // Fallback: { cells: { ... } } shape used in mocks.
  const cells = (record as any).cells;
  if (cells && typeof cells === "object" && !Array.isArray(cells)) {
    for (const [k, v] of Object.entries(cells)) {
      if (k.toLowerCase() === want) {
        return v != null ? String(v) : null;
      }
    }
  }
  if (Array.isArray(cells)) {
    for (const c of cells) {
      const k = (c?.key ?? c?.field ?? c?.column_name ?? "").toString().toLowerCase();
      if (k === want) {
        const v = c?.value ?? null;
        return v != null ? String(v) : null;
      }
    }
  }
  return null;
}

// Build the canonical input lookup: normalizedDomain → originalInputIndex.
// Duplicate normalized domains map to their first input row.
function buildInputLookup(inputs: DomainInput[]): {
  validInputs: Array<{ index: number; rowId: string; domain: string; name: string }>;
  malformed: string[];
  byDomain: Map<string, number>;
  byRowId: Map<string, number>;
} {
  const validInputs: Array<{ index: number; rowId: string; domain: string; name: string }> = [];
  const malformed: string[] = [];
  const byDomain = new Map<string, number>();
  const byRowId = new Map<string, number>();

  // Duplicates (different inputs that normalize to the same domain) are
  // silently de-duplicated to a single CSV row. Both inputs end up pointing at
  // the same lead in the result via the shared input row.
  inputs.forEach((inp, i) => {
    void i;
    const norm = normalizeDomain(inp.domain ?? "");
    if (!norm) {
      malformed.push(inp.domain ?? "");
      return;
    }
    if (byDomain.has(norm)) return;
    const rowId = randomUUID();
    const idx = validInputs.length;
    validInputs.push({ index: idx, rowId, domain: norm, name: inp.name?.trim() || norm });
    byDomain.set(norm, idx);
    byRowId.set(rowId, idx);
  });

  return { validInputs, malformed, byDomain, byRowId };
}

interface ChunkResult {
  importId: string;
  records: ImportRecordPayload[];
}

async function pollUntil<T>(
  fn: () => Promise<T>,
  done: (r: T) => boolean,
  budgetMs: number,
  signal: AbortSignal | undefined,
  ctx: ToolContext | undefined,
  label: string
): Promise<T> {
  const deadline = Date.now() + budgetMs;
  let last: T;
  while (true) {
    checkAborted(signal);
    last = await fn();
    if (done(last)) return last;
    if (Date.now() >= deadline) {
      ctx?.logger?.warn?.(`import-leads: ${label} budget exhausted (${budgetMs}ms)`);
      return last;
    }
    await sleepWithAbort(POLL_INTERVAL_MS, signal);
  }
}

async function pollPreprocess(
  client: LeadbayClient,
  importId: string,
  budgetMs: number,
  ctx: ToolContext | undefined,
  signal: AbortSignal | undefined
): Promise<FileImportPayloadV15> {
  const result = await pollUntil<FileImportPayloadV15>(
    () => client.request<FileImportPayloadV15>("GET", `/imports/${importId}`),
    (r) => Boolean(r.pre_processing?.finished),
    budgetMs,
    signal,
    ctx,
    "preprocess"
  );
  if (!result.pre_processing?.finished) {
    throw client.makeError(
      "IMPORT_BUDGET_EXHAUSTED",
      `Preprocess phase did not finish within ${budgetMs}ms`,
      `Increase per_phase_budget_ms (current: ${budgetMs}) or split the batch. importId=${importId}.`,
      `GET /imports/${importId}`
    );
  }
  if (result.pre_processing.error) {
    throw client.makeError(
      "IMPORT_PREPROCESS_FAILED",
      `Preprocess failed: ${result.pre_processing.error}`,
      `Check the input domains. importId=${importId} for backend debugging.`,
      `GET /imports/${importId}`
    );
  }
  return result;
}

async function pollProcess(
  client: LeadbayClient,
  importId: string,
  budgetMs: number,
  ctx: ToolContext | undefined,
  signal: AbortSignal | undefined
): Promise<FileImportPayloadV15> {
  const result = await pollUntil<FileImportPayloadV15>(
    () => client.request<FileImportPayloadV15>("GET", `/imports/${importId}`),
    (r) => Boolean(r.processing?.finished),
    budgetMs,
    signal,
    ctx,
    "process"
  );
  if (!result.processing?.finished) {
    throw client.makeError(
      "IMPORT_BUDGET_EXHAUSTED",
      `Process phase did not finish within ${budgetMs}ms`,
      `Increase per_phase_budget_ms (current: ${budgetMs}) or split the batch. importId=${importId}.`,
      `GET /imports/${importId}`
    );
  }
  if (result.processing.error != null) {
    throw client.makeError(
      "IMPORT_PROCESSING_FAILED",
      `Backend processing failed: ${result.processing.error}`,
      `importId=${importId}.`,
      `GET /imports/${importId}`
    );
  }
  return result;
}

// Pull all records pages until: (a) no rows in matching|importing AND
// (b) total counts stable for STABILIZATION_POLLS consecutive polls. The
// "all-statuses-true" flag set is required by the backend route.
async function pollRecordsToTerminal(
  client: LeadbayClient,
  importId: string,
  budgetMs: number,
  expectedRowCount: number,
  ctx: ToolContext | undefined,
  signal: AbortSignal | undefined
): Promise<ImportRecordPayload[]> {
  const deadline = Date.now() + budgetMs;
  // Hard cap on pages per attempt — bounded by expected row count + slack.
  const maxPagesPerPoll = Math.max(2, Math.ceil(expectedRowCount / 100) * 2 + 4);
  let stableCounts = 0;
  let lastSnapshot: { total: number; transient: number } | null = null;

  while (true) {
    checkAborted(signal);
    let total = 0;
    let transient = 0;
    let pagesFetched = 0;
    let exhaustedPagination = false;
    const records: ImportRecordPayload[] = [];

    for (let page = 0; page < maxPagesPerPoll; page++) {
      checkAborted(signal);
      const qs =
        `count=100&page=${page}` +
        `&automatic_match=true&manual_match=true&no_match=true` +
        `&matching=true&importing=true&imported=true`;
      const res = await client.request<PaginatedResponse<ImportRecordPayload>>(
        "GET",
        `/imports/${importId}/records?${qs}`
      );
      pagesFetched++;
      records.push(...res.items);
      total = res.pagination.total ?? records.length;
      // A record is terminal if match_type is NO_MATCH (the wizard's final
      // verdict for unknown domains — these records stay status=IMPORTING
      // forever, which the wizard sets at insert time but never transitions
      // out of when the lead match fails) OR status is IMPORTED (the wizard
      // finished linking a matched record to the org's CRM).
      for (const r of res.items) {
        const status = (r.status ?? "").toString().toUpperCase();
        const matchType =
          ((r as any).match_type ?? (r as any).matchType ?? "").toString().toUpperCase();
        const isTerminal = matchType === "NO_MATCH" || status === "IMPORTED";
        if (!isTerminal) transient++;
      }
      // Stop paginating when no more pages. Track whether we exhausted so the
      // runaway check below doesn't spuriously fire when totalPages exactly
      // equals maxPagesPerPoll (legitimate full-pagination case).
      const totalPages = res.pagination.pages ?? 0;
      if (page + 1 >= totalPages) {
        exhaustedPagination = true;
        break;
      }
    }
    if (!exhaustedPagination) {
      throw client.makeError(
        "IMPORT_PAGINATION_RUNAWAY",
        `Records pagination exceeded ${maxPagesPerPoll} pages`,
        `importId=${importId}. Please file a bug at https://github.com/leadbay/leadclaw/issues.`,
        `GET /imports/${importId}/records`
      );
    }

    const snapshot = { total, transient };
    const settled = transient === 0;
    const stableVsLast =
      lastSnapshot != null &&
      lastSnapshot.total === snapshot.total &&
      lastSnapshot.transient === snapshot.transient;
    if (settled && stableVsLast) {
      stableCounts++;
    } else if (settled) {
      stableCounts = 1;
    } else {
      stableCounts = 0;
    }
    lastSnapshot = snapshot;

    if (settled && stableCounts >= STABILIZATION_POLLS) {
      return records;
    }
    if (Date.now() >= deadline) {
      ctx?.logger?.warn?.(
        `import-leads: records did not stabilize (transient=${transient}, total=${total}); returning best-effort`
      );
      throw client.makeError(
        "IMPORT_NOT_TERMINAL",
        `Backend hasn't fully settled records within ${budgetMs}ms`,
        `Retry leadbay_import_leads with the same domains in 30s, or split the batch. importId=${importId}.`,
        `GET /imports/${importId}/records`
      );
    }
    await sleepWithAbort(POLL_INTERVAL_MS, signal);
  }
}

interface ChunkRunOutput {
  importId: string;
  records: ImportRecordPayload[];
}

async function runOneChunk(
  client: LeadbayClient,
  chunk: Array<{ index: number; rowId: string; domain: string; name: string }>,
  chunkIdx: number,
  totalChunks: number,
  dryRun: boolean,
  perPhaseBudgetMs: number,
  totalDeadline: number,
  ctx: ToolContext | undefined,
  signal: AbortSignal | undefined,
  // Called the moment POST /imports succeeds, so the caller can record the
  // importId before any polling happens. If polling later throws (abort,
  // budget, etc.) the caller still has the importId for diagnostics + retry.
  onImportId: (id: string) => void
): Promise<ChunkRunOutput> {
  const csv = synthesizeCsv(
    chunk.map((c) => ({ rowId: c.rowId, name: c.name, website: c.domain }))
  );
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `mcp-import-${ts}-${chunkIdx}.csv`;
  ctx?.logger?.info?.(
    `import-leads: uploading chunk ${chunkIdx + 1}/${totalChunks} (${chunk.length} rows, ${csv.length}B)`
  );

  const upload = await client.requestRawBinary<FileImportPayloadV15>(
    "POST",
    `/imports?file_name=${encodeURIComponent(fileName)}`,
    "text/csv",
    csv
  );
  const importId = upload.id;
  onImportId(importId);
  const phaseBudget = Math.min(perPhaseBudgetMs, Math.max(1, totalDeadline - Date.now()));

  // 1) Preprocess
  await pollPreprocess(client, importId, phaseBudget, ctx, signal);
  ctx?.logger?.info?.(`import-leads: preprocess done for importId=${importId}`);

  if (dryRun) {
    // No update_mappings → no auto-import. The import row stays in the user's
    // CRM-imports list as "preprocessed but not committed". This is the best
    // dry-run the wedge can offer; it skips the lead-CRM linking which is the
    // bulk of the side effect.
    return { importId, records: [] };
  }

  // 2) Commit mappings. Live wire format (2026-04-28): mapping keys are
  // CSV-column-header NAMES (e.g. "LEAD_NAME", "LEAD_WEBSITE"), not column
  // indices. We deliberately do NOT include MCP_ROW_ID — the wizard's
  // CrmFieldType enum doesn't accept unknowns, but it tolerates extra CSV
  // columns by leaving them unmapped (the value still flows through to
  // record.records[] for reconciliation).
  const mappings: MappingsPayload = {
    fields: { LEAD_NAME: "LEAD_NAME", LEAD_WEBSITE: "LEAD_WEBSITE" },
    statuses: {},
    default_status: null,
  };
  await client.requestVoid(
    "POST",
    `/imports/${importId}/update_mappings`,
    mappings
  );
  ctx?.logger?.info?.(`import-leads: mappings committed for importId=${importId}`);

  // 3) Process
  const phaseBudget2 = Math.min(perPhaseBudgetMs, Math.max(1, totalDeadline - Date.now()));
  await pollProcess(client, importId, phaseBudget2, ctx, signal);
  ctx?.logger?.info?.(`import-leads: process done for importId=${importId}`);

  // 4) Records to terminal
  const phaseBudget3 = Math.min(perPhaseBudgetMs, Math.max(1, totalDeadline - Date.now()));
  const records = await pollRecordsToTerminal(
    client,
    importId,
    phaseBudget3,
    chunk.length,
    ctx,
    signal
  );
  ctx?.logger?.info?.(
    `import-leads: ${records.length} records terminal for importId=${importId}`
  );

  return { importId, records };
}

function reconcileOneChunk(
  chunk: ChunkRunOutput,
  byRowIdGlobal: Map<string, number>,
  byDomainGlobal: Map<string, number>,
  validInputsGlobal: Array<{ index: number; rowId: string; domain: string; name: string }>,
  matched: Map<number, { domain: string; leadId: string; name: string | null }>,
  notImported: Map<number, { domain: string; reason: NotImportedReason }>
): void {
  const seenInputIndex = new Set<number>();

  // Sort so matched records (lead.id present) come first. If the wizard ever
  // emits multiple records for one CSV row (theoretical — backend currently
  // creates one row per CSV row), we want the match to win, not be hidden by
  // an earlier no-match record landing in `seenInputIndex` first.
  const sortedRecords = [...chunk.records].sort((a, b) => {
    const aHasLead = a.lead?.id ? 0 : 1;
    const bHasLead = b.lead?.id ? 0 : 1;
    return aHasLead - bHasLead;
  });

  for (const rec of sortedRecords) {
    // Try MCP_ROW_ID first (most reliable).
    let inputIdx: number | undefined;
    const rowIdCell = readCell(rec, "MCP_ROW_ID");
    if (rowIdCell && byRowIdGlobal.has(rowIdCell)) {
      inputIdx = byRowIdGlobal.get(rowIdCell);
    }
    // Fallback: match by normalized domain (LEAD_WEBSITE cell).
    if (inputIdx === undefined) {
      const websiteCell = readCell(rec, "LEAD_WEBSITE");
      if (websiteCell) {
        const norm = normalizeDomain(websiteCell);
        if (norm && byDomainGlobal.has(norm)) {
          inputIdx = byDomainGlobal.get(norm);
        }
      }
    }
    // Fallback: match record.lead.website.
    if (inputIdx === undefined && rec.lead?.website) {
      const norm = normalizeDomain(rec.lead.website);
      if (norm && byDomainGlobal.has(norm)) {
        inputIdx = byDomainGlobal.get(norm);
      }
    }
    if (inputIdx === undefined) continue; // Couldn't map — wizard row not from us.

    if (seenInputIndex.has(inputIdx)) {
      // Multiple records for the same input row → ambiguous. If we already
      // have a match, keep it; if not, mark as ambiguous.
      if (!matched.has(inputIdx) && !notImported.has(inputIdx)) {
        const inp = validInputsGlobal[inputIdx];
        notImported.set(inputIdx, { domain: inp.domain, reason: "ambiguous" });
      }
      continue;
    }
    seenInputIndex.add(inputIdx);

    const inp = validInputsGlobal[inputIdx];
    const matchType =
      ((rec as any).match_type ?? (rec as any).matchType ?? "").toString();
    if (rec.lead?.id) {
      matched.set(inputIdx, {
        domain: inp.domain,
        leadId: rec.lead.id,
        name: rec.lead.name ?? null,
      });
    } else if (matchType === "NO_MATCH") {
      const reason: NotImportedReason = PUBLIC_MAILBOX_DOMAINS.has(inp.domain)
        ? "no_match"
        : "uncrawled";
      notImported.set(inputIdx, { domain: inp.domain, reason });
    } else {
      // Record exists, but no lead and not yet NO_MATCH — treat as
      // internal_error so the caller can investigate.
      notImported.set(inputIdx, { domain: inp.domain, reason: "internal_error" });
    }
  }
}

export const importLeads: Tool<ImportLeadsParams, ImportLeadsResult> = {
  name: "leadbay_import_leads",
  description:
    "Import a list of company domains and get back stable Leadbay leadIds for downstream chaining " +
    "into leadbay_bulk_qualify_leads / leadbay_research_lead.\n\n" +
    "⚠️ MUTATES USER STATE. This tool wraps Leadbay's CRM-import wizard. Each call:\n" +
    "  - creates a row in the user's CRM-imports list (visible in the web UI)\n" +
    "  - touches onboarding state (startFileless, onboarding step → PROCESSING)\n" +
    "Suitable for occasional automation. NOT suitable for high-cadence (>5 calls/day) — wait for " +
    "the backend programmatic endpoint (issue: leadbay/backend prolonged-import-with-crawl).\n\n" +
    "Returns: leads = leadIds for domains Leadbay already knows about (via crawler). " +
    "not_imported = domains Leadbay doesn't know yet, with a reason. The tool does NOT create " +
    "new leads for unknown domains; the caller decides what to do.\n\n" +
    "When to use: you have a list of domains from another system (CRM, analytics, email " +
    "correspondents) and need to map them to Leadbay leadIds.\n" +
    "When NOT to use: for prospect discovery (use leadbay_pull_leads); for one specific company's " +
    "profile (use leadbay_research_company); when you can't tolerate the side effects above.\n\n" +
    "Requires: LEADBAY_MCP_WRITE=1 (MCP) or exposeWrite=true (OpenClaw); admin role on the " +
    "Leadbay account; active billing.",
  write: true,
  version: "0.1.0",
  inputSchema: {
    type: "object",
    properties: {
      domains: {
        type: "array",
        description: "List of company domains to map to Leadbay leadIds.",
        items: {
          type: "object",
          properties: {
            domain: {
              type: "string",
              description: "Company domain (e.g. 'apple.com'). Protocol/path are stripped.",
            },
            name: {
              type: "string",
              description: "Optional display name override; defaults to the domain.",
            },
          },
          required: ["domain"],
        },
      },
      dry_run: {
        type: "boolean",
        description:
          "If true, run preprocess only — do NOT commit lead-CRM linking. Note: an import row " +
          "still appears in the user's CRM-imports list as 'incomplete'. Use to verify domain " +
          "format / wizard reachability without polluting the CRM.",
      },
      per_phase_budget_ms: {
        type: "number",
        description: `Single poll-loop cap (default ${DEFAULT_PER_PHASE_BUDGET_MS}ms).`,
      },
      total_budget_ms: {
        type: "number",
        description: `Overall cap across all phases (default ${DEFAULT_TOTAL_BUDGET_MS}ms).`,
      },
    },
    required: ["domains"],
  },
  execute: async (
    client: LeadbayClient,
    params: ImportLeadsParams,
    ctx?: ToolContext
  ): Promise<ImportLeadsResult> => {
    const signal = ctx?.signal;
    const dryRun = Boolean(params.dry_run);
    const perPhaseBudget = params.per_phase_budget_ms ?? DEFAULT_PER_PHASE_BUDGET_MS;
    const totalBudget = params.total_budget_ms ?? DEFAULT_TOTAL_BUDGET_MS;
    const totalDeadline = Date.now() + totalBudget;

    // Empty input fail-fast.
    if (!Array.isArray(params.domains) || params.domains.length === 0) {
      throw client.makeError(
        "IMPORT_EMPTY_INPUT",
        "domains[] must contain at least one entry",
        "Pass at least one domain in domains[].",
        "POST /imports"
      );
    }

    // Preflight admin check. The /imports route is admin-gated server-side
    // and would 403 ~30s into polling otherwise — bad DX. resolveMe() is
    // cached (60s TTL).
    const me = await client.resolveMe();
    if (!me.admin) {
      throw client.makeError(
        "IMPORT_ADMIN_REQUIRED",
        "This tool requires admin role on the Leadbay account",
        "Ask the account owner to grant import permission, or use a token from an admin user.",
        "POST /imports"
      );
    }

    // Normalize + dedupe; collect malformed entries.
    const lookup = buildInputLookup(params.domains);
    if (lookup.validInputs.length === 0) {
      const not_imported = lookup.malformed.map((d) => ({
        domain: d,
        reason: "malformed" as const,
      }));
      return {
        leads: [],
        not_imported,
        importIds: [],
        region: client.region,
        dry_run: dryRun || undefined,
        _meta: client.lastMeta ?? {
          region: client.region,
          endpoint: "POST /imports",
          latency_ms: null,
          retry_after: null,
        },
      };
    }

    // Chunk + run.
    const chunks = chunkAt100(lookup.validInputs);
    ctx?.logger?.info?.(
      `import-leads: ${lookup.validInputs.length} domains → ${chunks.length} chunk(s); ` +
        `dry_run=${dryRun}, totalBudgetMs=${totalBudget}`
    );

    const importIds: string[] = [];
    const matched = new Map<number, { domain: string; leadId: string; name: string | null }>();
    const notImported = new Map<number, { domain: string; reason: NotImportedReason }>();

    let cancelled = false;
    // Capture the importId the moment POST /imports succeeds, BEFORE any
    // polling. If polling throws (abort, budget, processing error), the
    // caller still gets the importId in the response so they can re-poll
    // or diagnose later.
    const recordImportId = (id: string) => {
      if (!importIds.includes(id)) importIds.push(id);
    };
    try {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const out = await runOneChunk(
          client,
          chunk,
          i,
          chunks.length,
          dryRun,
          perPhaseBudget,
          totalDeadline,
          ctx,
          signal,
          recordImportId
        );
        // recordImportId already pushed; runOneChunk returning here means
        // the chunk completed cleanly through to terminal records.
        if (!dryRun) {
          reconcileOneChunk(
            out,
            lookup.byRowId,
            lookup.byDomain,
            lookup.validInputs,
            matched,
            notImported
          );
        } else {
          // dry_run: every input is "not_imported" with reason=dry_run
          for (const c of chunk) {
            notImported.set(c.index, { domain: c.domain, reason: "dry_run" });
          }
        }
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        cancelled = true;
        ctx?.logger?.info?.(`import-leads: aborted via signal; importIds=${importIds.join(",")}`);
      } else if (err?.error === true) {
        // LeadbayError envelope — re-throw with our codes intact, but remap
        // 403 from /imports to a tool-specific code.
        if (err.code === "FORBIDDEN") {
          throw client.makeError(
            "IMPORT_ADMIN_REQUIRED",
            err.message || "Insufficient permissions for /imports",
            "This tool requires admin role on the Leadbay account. Ask the account owner.",
            err._meta?.endpoint
          );
        }
        if (err.code === "BILLING_SUSPENDED") {
          throw client.makeError(
            "IMPORT_BILLING_REQUIRED",
            err.message || "Active billing required for imports",
            "Upgrade at https://app.leadbay.ai/billing, then retry.",
            err._meta?.endpoint
          );
        }
        throw err;
      } else {
        throw err;
      }
    }

    // Append the malformed inputs (rejected before the wizard sees them).
    for (const m of lookup.malformed) {
      notImported.set(-1 - notImported.size, { domain: m, reason: "malformed" });
    }

    // Build the output. Inputs that didn't appear in either matched or
    // notImported (e.g. the wizard ate the row silently) are surfaced as
    // internal_error so the caller can retry.
    const leads: Array<{ domain: string; leadId: string; name: string | null }> = [];
    const not_imported: Array<{ domain: string; reason: NotImportedReason }> = [];
    if (dryRun) {
      for (const inp of lookup.validInputs) {
        not_imported.push({ domain: inp.domain, reason: "dry_run" });
      }
    } else {
      for (const inp of lookup.validInputs) {
        const m = matched.get(inp.index);
        if (m) {
          leads.push(m);
          continue;
        }
        const ni = notImported.get(inp.index);
        if (ni) {
          not_imported.push(ni);
          continue;
        }
        not_imported.push({ domain: inp.domain, reason: "internal_error" });
      }
    }
    // Append malformed (negative-keyed entries) at the end.
    for (const [k, v] of notImported) {
      if (k < 0) not_imported.push(v);
    }

    return {
      leads,
      not_imported,
      importIds,
      region: client.region,
      cancelled: cancelled || undefined,
      dry_run: dryRun || undefined,
      _meta: client.lastMeta ?? {
        region: client.region,
        endpoint: "POST /imports",
        latency_ms: null,
        retry_after: null,
      },
    };
  },
};
