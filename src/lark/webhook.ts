import type { WorkflowOrchestrator } from "../workflow/orchestrator.js";
import type { LarkClient } from "./larkClient.js";
import { createLogger, type Logger } from "../utils/logger.js";

export type LarkWebhookHandlerOptions = {
  larkClient: LarkClient;
  workflow: WorkflowOrchestrator;
  logger?: Logger;
};

export type LarkWebhookRequest = {
  body: Buffer;
};

export type LarkWebhookResponse = {
  status: number;
  body: Record<string, unknown>;
};

type LarkEvent =
  | {
      type: "doc_update";
      taskId: string;
      docToken?: string;
      markdown?: string;
    }
  | {
      type: "comment";
      taskId: string;
      docToken?: string;
      commentId?: string;
      content: string;
    }
  | {
      type: "card_action";
      taskId: string;
      docToken?: string;
      action: string;
      value: Record<string, unknown>;
    };

export class LarkWebhookHandler {
  private logger: Logger;

  constructor(private options: LarkWebhookHandlerOptions) {
    this.logger = options.logger ?? createLogger({ prefix: "LarkWebhook" });
  }

  async handle(request: LarkWebhookRequest): Promise<LarkWebhookResponse> {
    const payload = parseJson(request.body);
    if (!payload) {
      return { status: 400, body: { error: "Invalid JSON" } };
    }

    const challenge = extractChallenge(payload);
    if (challenge) {
      return { status: 200, body: { challenge } };
    }

    const event = extractEvent(payload);
    if (!event) {
      this.logger.info("Ignored Lark webhook event");
      return { status: 200, body: { ok: true, ignored: true } };
    }

    const resolvedTaskId = event.docToken
      ? await this.options.workflow.resolveTaskIdByDocToken(event.docToken)
      : null;
    switch (event.type) {
      case "doc_update": {
        const taskId = resolvedTaskId ?? event.taskId;
        const resolved = event.docToken
          ? await this.options.larkClient.resolveDocToken(event.docToken)
          : null;
        const docToken = resolved?.token ?? event.docToken;
        const markdown =
          event.markdown ??
          (docToken
            ? await this.options.larkClient.fetchDocMarkdown(docToken)
            : undefined);
        if (!markdown) {
          return { status: 200, body: { ok: true, ignored: true } };
        }
        await this.options.workflow.handleDocContext(
          taskId,
          markdown,
          docToken,
        );
        return { status: 200, body: { ok: true } };
      }
      case "comment": {
        const taskId = resolvedTaskId ?? event.taskId;
        const reply = await this.options.workflow.handleLarkComment(
          taskId,
          event.content,
        );
        const resolved = event.docToken
          ? await this.options.larkClient.resolveDocToken(event.docToken)
          : null;
        const docToken = resolved?.token ?? event.docToken;
        if (reply && docToken) {
          await this.options.larkClient.postDocComment({
            docToken,
            payload: buildCommentPayload(reply, event.commentId),
          });
        }
        return { status: 200, body: { ok: true } };
      }
      case "card_action": {
        if (event.action === "start_coding") {
          void this.options.workflow.startCoding(resolvedTaskId ?? event.taskId);
        }
        return { status: 200, body: { ok: true } };
      }
      default:
        return { status: 200, body: { ok: true, ignored: true } };
    }
  }
}


function parseJson(body: Buffer): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body.toString("utf8"));
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch (error) {
    void error;
  }
  return null;
}

function extractChallenge(payload: Record<string, unknown>): string | null {
  const challenge = payload.challenge;
  if (typeof challenge === "string" && challenge.length > 0) {
    return challenge;
  }
  return null;
}

function extractEvent(payload: Record<string, unknown>): LarkEvent | null {
  const event = isRecord(payload.event) ? payload.event : null;
  const eventType = getString(event?.type) ?? getString(payload.type);

  const actionNode = isRecord(event?.action) ? event?.action : null;
  const actionValue = isRecord(actionNode?.value) ? actionNode?.value : null;
  const taskId =
    getString(actionValue?.task_id) ??
    getString(actionValue?.taskId) ??
    getString(event?.task_id) ??
    getString(event?.taskId) ??
    getString(event?.doc_token) ??
    getString(event?.docToken) ??
    getString((event?.doc as Record<string, unknown> | undefined)?.token) ??
    getString((event?.doc as Record<string, unknown> | undefined)?.doc_token);

  const docToken =
    getString(event?.doc_token) ??
    getString(event?.docToken) ??
    getString((event?.doc as Record<string, unknown> | undefined)?.token) ??
    getString((event?.doc as Record<string, unknown> | undefined)?.doc_token);

  if (!taskId) {
    return null;
  }

  const comment = extractComment(event, eventType);
  if (comment) {
    return { type: "comment", taskId, docToken, ...comment };
  }

  const action = extractCardAction(event, eventType);
  if (action) {
    return { type: "card_action", taskId, docToken, ...action };
  }

  const docUpdate = extractDocUpdate(event, eventType);
  if (docUpdate) {
    return { type: "doc_update", taskId, docToken, ...docUpdate };
  }

  return null;
}

function extractComment(
  event: Record<string, unknown> | null,
  eventType?: string,
): { docToken?: string; commentId?: string; content: string } | null {
  if (!event) {
    return null;
  }

  const commentNode = isRecord(event.comment) ? event.comment : null;
  const rawContent =
    commentNode?.content ??
    commentNode?.text ??
    event.comment_content ??
    (eventType?.includes("comment") ? event.content : undefined);
  const content = stringifyContent(rawContent);
  if (!content) {
    return null;
  }

  return {
    docToken:
      getString(event.doc_token) ??
      getString(event.docToken) ??
      getString((event.doc as Record<string, unknown> | undefined)?.token) ??
      getString((event.doc as Record<string, unknown> | undefined)?.doc_token),
    commentId:
      getString(commentNode?.comment_id) ??
      getString(commentNode?.commentId) ??
      getString(event.comment_id) ??
      getString(event.commentId),
    content,
  };
}

function extractCardAction(
  event: Record<string, unknown> | null,
  eventType?: string,
): { action: string; value: Record<string, unknown> } | null {
  if (!event) {
    return null;
  }

  if (eventType && !eventType.includes("action")) {
    return null;
  }

  const actionNode = isRecord(event.action) ? event.action : null;
  const valueNode = isRecord(actionNode?.value)
    ? actionNode?.value
    : actionNode;
  if (!valueNode) {
    return null;
  }

  const action = getString(valueNode.action) ?? getString(actionNode?.action);
  if (!action) {
    return null;
  }

  return { action, value: valueNode };
}

function extractDocUpdate(
  event: Record<string, unknown> | null,
  eventType?: string,
): { docToken?: string; markdown?: string } | null {
  if (!event) {
    return null;
  }

  if (eventType && !eventType.includes("doc")) {
    return null;
  }

  const docNode = isRecord(event.doc) ? event.doc : null;
  const markdown =
    stringifyContent(docNode?.markdown) ??
    stringifyContent(docNode?.content) ??
    stringifyContent(event.doc_content) ??
    stringifyContent(event.content);

  if (!markdown) {
    return null;
  }

  return {
    docToken:
      getString(event.doc_token) ??
      getString(event.docToken) ??
      getString(docNode?.token) ??
      getString(docNode?.doc_token),
    markdown,
  };
}

function stringifyContent(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const text = record.text;
    if (typeof text === "string") {
      return text;
    }
  }
  return null;
}

function buildCommentPayload(
  content: string,
  commentId?: string,
): Record<string, unknown> {
  const reply = {
    content: {
      elements: [
        {
          type: "text_run",
          text_run: { text: content },
        },
      ],
    },
  };

  if (commentId) {
    return {
      comment_id: commentId,
      reply_list: { replies: [reply] },
    };
  }

  return { reply_list: { replies: [reply] } };
}

function getString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
