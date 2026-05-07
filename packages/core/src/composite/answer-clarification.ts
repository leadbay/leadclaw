import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext, ClarificationPayload } from "../types.js";

interface AnswerClarificationParams {
  option_id?: string;
  text_answer?: string;
}

export const answerClarification: Tool<AnswerClarificationParams> = {
  name: "leadbay_answer_clarification",
  annotations: {
    title: "Answer pending clarification",
    readOnlyHint: false,
    destructiveHint: true,
    // Records a one-time answer that becomes the new user_prompt and
    // triggers regeneration. Re-calling with a different answer wins;
    // not idempotent.
    idempotentHint: false,
    openWorldHint: true,
  },
  description:
    "Answer the pending clarification question Leadbay raised after a refine_prompt. The answer is stored as " +
    "the new user_prompt and triggers regeneration. Pass option_id (preferred — pick from the offered options) " +
    "or text_answer (free-text). Admin-only. " +
    "When to use: after leadbay_refine_prompt returns status='clarification_pending'. " +
    "When NOT to use: to set a brand-new prompt — use leadbay_refine_prompt.",
  inputSchema: {
    type: "object",
    properties: {
      option_id: { type: "string", description: "Id of one of the clarification's options" },
      text_answer: { type: "string", description: "Free-text answer (overrides option_id)" },
    },
    additionalProperties: false,
  },
  execute: async (
    client: LeadbayClient,
    params: AnswerClarificationParams,
    ctx?: ToolContext
  ) => {
    if (!params.option_id && !params.text_answer) {
      return {
        error: true,
        code: "BAD_INPUT",
        message: "Provide option_id or text_answer",
        hint: "Call leadbay_get_clarification first to see the options",
      };
    }

    const me = await client.resolveMe();
    if (me.admin !== true) {
      return {
        error: true,
        code: "FORBIDDEN",
        message: "Answering clarifications requires admin rights",
        hint: "Ask your Leadbay org admin to answer the clarification",
      };
    }

    const orgId = me.organization.id;

    // Confirm there's actually a pending clarification before answering.
    const pending = await client.request<ClarificationPayload | null>(
      "GET",
      `/organizations/${orgId}/clarifications`
    );
    if (!pending) {
      return {
        status: "no_pending_clarification",
        hint:
          "There's no pending clarification — either it was already answered or none was raised. Use leadbay_refine_prompt to set a new prompt.",
      };
    }

    const body: Record<string, string> = {};
    if (params.text_answer) body.text_answer = params.text_answer;
    if (params.option_id) body.option_id = params.option_id;

    await client.requestVoid(
      "POST",
      `/organizations/${orgId}/pick_clarification`,
      body
    );

    // The backend stores the answer as the new user_prompt and clears
    // clarification — invalidate /me cache (computing_intelligence is now true).
    client.invalidateMe();

    return {
      status: "answered",
      recorded_as_user_prompt: true,
      message:
        "Answer recorded. Leadbay is regenerating intelligence based on it. Check leadbay_account_status for computing_intelligence.",
      _meta: { region: client.region },
    };
  },
};
