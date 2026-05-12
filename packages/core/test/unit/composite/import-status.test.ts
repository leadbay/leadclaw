/**
 * Unit tests for leadbay_import_status.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { importStatus } from "../../../src/composite/import-status.js";
import { InMemoryBulkStore, LocalBulkStore } from "../../../src/jobs/bulk-store.js";

const BASE = "https://api-us.leadbay.app";

function newClient() {
  return new LeadbayClient(BASE, "u.tok", "us");
}

let tmpDirs: string[] = [];

beforeEach(() => {
  resetHttpMock();
  tmpDirs = [];
});

afterEach(async () => {
  await Promise.all(tmpDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("leadbay_import_status", () => {
  it("returns progress for a persisted handle with a single backend refresh", async () => {
    const tracker = new InMemoryBulkStore();
    const { record } = await tracker.findOrCreatePendingImport({
      import_fingerprint: "fp-progress",
      mode: "domains",
      dry_run: false,
      records_total: 10,
    });
    await tracker.setImportIds(record.bulk_id, ["imp-1"]);

    mockHttp([
      {
        method: "GET",
        path: "/1.5/imports/imp-1",
        status: 200,
        body: importPayload({
          id: "imp-1",
          totalRecords: 10,
          importedRecords: 4,
          preFinished: true,
          procFinished: false,
        }),
      },
    ]);

    const out = await importStatus.execute(
      newClient(),
      { handle_id: record.bulk_id },
      { bulkTracker: tracker }
    );

    expect(out).toMatchObject({
      status: "running",
      handle_id: record.bulk_id,
      importIds: ["imp-1"],
      progress: {
        phase: "process",
        records_processed: 4,
        records_total: 10,
      },
    });
    expect(getHttpRequests().map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /1.5/imports/imp-1",
    ]);
  });

  it("does not mark a non-dry-run handle complete after preprocess only", async () => {
    const tracker = new InMemoryBulkStore();
    const { record } = await tracker.findOrCreatePendingImport({
      import_fingerprint: "fp-preprocess-only",
      mode: "domains",
      dry_run: false,
      records_total: 1,
    });
    await tracker.setImportIds(record.bulk_id, ["imp-pre"]);

    mockHttp([
      {
        method: "GET",
        path: "/1.5/imports/imp-pre",
        status: 200,
        body: importPayload({
          id: "imp-pre",
          totalRecords: 1,
          importedRecords: 0,
          preFinished: true,
        }),
      },
    ]);

    const out = await importStatus.execute(
      newClient(),
      { handle_id: record.bulk_id },
      { bulkTracker: tracker }
    );

    expect(out.status).toBe("running");
    expect(out.progress.phase).toBe("process");
  });

  it("returns the stored final result without HTTP once the handle is complete", async () => {
    const tracker = new InMemoryBulkStore();
    const { record } = await tracker.findOrCreatePendingImport({
      import_fingerprint: "fp-complete",
      mode: "domains",
      dry_run: false,
      records_total: 1,
    });
    await tracker.markImportComplete(record.bulk_id, {
      leads: [{ domain: "apple.com", leadId: "lead-apple", name: "Apple Inc." }],
      not_imported: [],
      importIds: ["imp-1"],
    });

    const out = await importStatus.execute(
      newClient(),
      { handle_id: record.bulk_id },
      { bulkTracker: tracker }
    );

    expect(out.status).toBe("complete");
    expect(out.result).toEqual({
      leads: [{ domain: "apple.com", leadId: "lead-apple", name: "Apple Inc." }],
      not_imported: [],
      importIds: ["imp-1"],
    });
    expect(getHttpRequests()).toEqual([]);
  });

  it("accepts legacy importIds[] and reports completion from the backend row", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.5/imports/imp-legacy",
        status: 200,
        body: importPayload({
          id: "imp-legacy",
          totalRecords: 3,
          importedRecords: 3,
          preFinished: true,
          procFinished: true,
        }),
      },
    ]);

    const out = await importStatus.execute(newClient(), {
      importIds: ["imp-legacy"],
    });

    expect(out).toMatchObject({
      status: "complete",
      importIds: ["imp-legacy"],
      progress: {
        phase: "complete",
        records_processed: 3,
        records_total: 3,
      },
    });
  });

  it("resolves a handle after recreating LocalBulkStore", async () => {
    const dir = await mkdtemp(join(tmpdir(), "leadbay-import-status-"));
    tmpDirs.push(dir);
    const path = join(dir, "bulks.json");
    const firstStore = new LocalBulkStore({
      backend: "file",
      path,
      allowUnsafePath: true,
    });
    const { record } = await firstStore.findOrCreatePendingImport({
      import_fingerprint: "fp-restart",
      mode: "domains",
      dry_run: false,
      records_total: 2,
    });
    await firstStore.setImportIds(record.bulk_id, ["imp-restart"]);
    await firstStore.setImportProgress(record.bulk_id, {
      phase: "preprocess",
      records_processed: 0,
      records_total: 2,
    });

    const secondStore = new LocalBulkStore({
      backend: "file",
      path,
      allowUnsafePath: true,
    });

    mockHttp([
      {
        method: "GET",
        path: "/1.5/imports/imp-restart",
        status: 200,
        body: importPayload({
          id: "imp-restart",
          totalRecords: 2,
          importedRecords: 1,
          preFinished: true,
          procFinished: false,
        }),
      },
    ]);

    const out = await importStatus.execute(
      newClient(),
      { handle_id: record.bulk_id },
      { bulkTracker: secondStore }
    );

    expect(out).toMatchObject({
      status: "running",
      handle_id: record.bulk_id,
      importIds: ["imp-restart"],
      progress: {
        phase: "process",
        records_processed: 1,
        records_total: 2,
      },
    });
  });
});

function importPayload(opts: {
  id: string;
  totalRecords: number;
  importedRecords: number;
  preFinished: boolean;
  procFinished?: boolean;
  preError?: string | null;
  procError?: string | null;
}) {
  return {
    id: opts.id,
    date: new Date().toISOString(),
    file_name: "mcp-import.csv",
    imported_records: opts.importedRecords,
    pending_imported_records: Math.max(0, opts.totalRecords - opts.importedRecords),
    total_records: opts.totalRecords,
    mappings: null,
    pre_processing: {
      finished: opts.preFinished,
      error: opts.preError ?? null,
      hints: null,
      samples: [],
      status_samples: null,
    },
    processing:
      opts.procFinished === undefined
        ? null
        : {
            progress: opts.procFinished ? 1 : opts.importedRecords / opts.totalRecords,
            finished: opts.procFinished,
            error: opts.procError ?? null,
          },
  };
}
