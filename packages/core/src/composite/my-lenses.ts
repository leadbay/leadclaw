/**
 * leadbay_my_lenses — list the user's lenses and (optionally) switch the active one.
 *
 * Default-surface composite. With no args it is a pure read: GET /lenses,
 * merged with the active lens from /users/me.last_requested_lens (more
 * reliable than the payload's per-row is_last_active, which can be stale).
 * When `switchToLensId` is provided and resolves to one of the user's lenses,
 * it POSTs /lenses/{id}/update_last_requested, invalidates the /me + default
 * caches, and returns the REFRESHED list with the new active marked — so a
 * switch call doubles as a fresh listing.
 *
 * Distinct from the granular leadbay_list_lenses / leadbay_set_active_lens
 * (advanced-gated primitives) — this is the on-pattern default-surface tool
 * with routing + rendering.
 */
import type { LeadbayClient } from "../client.js";
import type { Tool, LensPayload } from "../types.js";

import { leadbay_my_lenses as MY_LENSES_DESCRIPTION } from "../tool-descriptions.generated.js";

interface MyLensesParams {
  switchToLensId?: number;
}

interface LensListEntry {
  id: number;
  name: string;
  description?: string | null;
  is_active: boolean;
}

async function listWithActive(
  client: LeadbayClient
): Promise<{ lenses: LensListEntry[]; active_lens_id: number | null }> {
  const lenses = await client.request<LensPayload[]>("GET", "/lenses");
  // Prefer /me.last_requested_lens for active state; fall back to the per-row
  // is_last_active flag if /me is unavailable.
  const me = await client.resolveMe().catch(() => null);
  const activeFromMe = me?.last_requested_lens ?? null;
  const active_lens_id =
    activeFromMe ?? lenses.find((l) => l.is_last_active)?.id ?? null;

  return {
    active_lens_id,
    lenses: lenses.map((l) => ({
      id: l.id,
      name: l.name,
      description: l.description ?? null,
      is_active: l.id === active_lens_id,
    })),
  };
}

export const myLenses: Tool<MyLensesParams> = {
  name: "leadbay_my_lenses",
  annotations: {
    title: "List or switch your lenses",
    // No args → pure read. A switch mutates last_requested_lens, so the tool
    // is not flagged read-only, but it never destroys data and re-calling with
    // the same target is a no-op.
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: MY_LENSES_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      switchToLensId: {
        type: "number",
        description:
          "When set, switch the active lens to this id (must be one of the user's lenses), then return the refreshed list. Omit to just list.",
      },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        description: "'listed', 'switched', or 'not_found' (unknown switch id).",
      },
      switched: {
        type: "boolean",
        description: "True when this call changed the active lens.",
      },
      active_lens_id: { type: ["number", "null"] },
      lenses: {
        type: "array",
        description:
          "The user's lenses. Each: {id, name, description, is_active}.",
        items: { type: "object" },
      },
      message: { type: "string" },
    },
    required: ["status", "lenses", "active_lens_id"],
  },
  execute: async (client: LeadbayClient, params: MyLensesParams) => {
    // Switch path — validate the target is a real lens before POSTing.
    if (params.switchToLensId != null) {
      const before = await listWithActive(client);
      const target = before.lenses.find((l) => l.id === params.switchToLensId);
      if (!target) {
        return {
          status: "not_found",
          switched: false,
          active_lens_id: before.active_lens_id,
          lenses: before.lenses,
          message: `No lens with id ${params.switchToLensId}. Pick an id from the list.`,
        };
      }
      if (target.is_active) {
        // Already active — no-op, just confirm.
        return {
          status: "switched",
          switched: false,
          active_lens_id: before.active_lens_id,
          lenses: before.lenses,
          message: `"${target.name}" is already your active lens.`,
        };
      }

      await client.requestVoid(
        "POST",
        `/lenses/${params.switchToLensId}/update_last_requested`
      );
      // last_requested_lens lives in the /me + default-lens caches — drop both
      // so the refreshed list reflects the change.
      client.invalidateMe();
      client.invalidateDefaultLens();

      const after = await listWithActive(client);
      return {
        status: "switched",
        switched: true,
        active_lens_id: after.active_lens_id,
        lenses: after.lenses,
        message: `Now showing "${target.name}".`,
      };
    }

    // List path (pure read).
    const { lenses, active_lens_id } = await listWithActive(client);
    return { status: "listed", switched: false, active_lens_id, lenses };
  },
};
