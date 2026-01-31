import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { CORSPlugin } from "@orpc/server/plugins";
import { Hono, type Context } from "hono";

import type { AppConfig } from "../config/types.js";
import type { LarkClient } from "../lark/larkClient.js";
import { LarkWebhookHandler } from "../lark/webhook.js";
import { router } from "../rpc/router.js";
import type { Logger } from "../utils/logger.js";
import type { WorkflowOrchestrator } from "../workflow/orchestrator.js";
import { GithubWebhookHandler } from "../vcs/githubWebhook.js";

export function createServer(
  config: AppConfig,
  logger: Logger,
  workflow: WorkflowOrchestrator,
  larkClient?: LarkClient,
) {
  const app = new Hono();
  const rpcHandler = new RPCHandler(router, {
    plugins: [new CORSPlugin()],
    interceptors: [
      onError((error) => {
        logger.withError(error).error("RPC handler error");
      }),
    ],
  });

  const githubHandler = config.github?.webhookSecret
    ? new GithubWebhookHandler({
        webhookSecret: config.github.webhookSecret,
        logger,
        workflow,
      })
    : null;

  const larkHandler =
    config.lark && larkClient
      ? new LarkWebhookHandler({
          larkClient,
          workflow,
          logger,
        })
      : null;

  app.get("/healthz", () => jsonResponse({ status: "ok" }, 200));

  const handleRpc = async (c: Context) => {
    const headers = Object.fromEntries(c.req.raw.headers.entries());
    const result = await rpcHandler.handle(c.req.raw, {
      prefix: "/rpc",
      context: { headers, workflow, lark: larkClient },
    });

    if (!result.matched || !result.response) {
      return jsonResponse({ error: "Not found" }, 404);
    }

    return result.response;
  };

  app.all("/rpc", handleRpc);
  app.all("/rpc/*", handleRpc);

  app.post("/webhooks/github", async (c) => {
    if (!githubHandler) {
      return jsonResponse({ error: "GitHub webhook not configured" }, 501);
    }

    const body = Buffer.from(await c.req.arrayBuffer());
    const signature = c.req.header("x-hub-signature-256");
    const event = c.req.header("x-github-event");
    const result = await githubHandler.handle({ body, signature, event });

    return jsonResponse(result.body, result.status);
  });

  app.post("/webhooks/lark", async (c) => {
    if (!larkHandler) {
      return jsonResponse({ error: "Lark webhook not configured" }, 501);
    }

    const body = Buffer.from(await c.req.arrayBuffer());
    const result = await larkHandler.handle({ body });

    return jsonResponse(result.body, result.status);
  });

  app.post("/mcp/:taskId", async (c) => {
    const taskId = c.req.param("taskId");
    const payload = await c.req.json();
    const method = payload?.method;
    if (method !== "tools/list" && method !== "tools/call") {
      return jsonResponse({ error: "Unsupported MCP method" }, 400);
    }

    const registry = await workflow.getToolRegistry(taskId);
    if (method === "tools/list") {
      return jsonResponse(
        {
          jsonrpc: "2.0",
          id: payload?.id ?? null,
          result: {
            tools: registry.toolDefinitions,
          },
        },
        200,
      );
    }

    const name = payload?.params?.name;
    const args = payload?.params?.arguments;
    if (typeof name !== "string" || name.length === 0) {
      return jsonResponse({ error: "Missing tool name" }, 400);
    }
    const handler = registry.toolHandlers[name];
    if (!handler) {
      return jsonResponse({ error: "Tool not registered" }, 404);
    }
    const output = await handler({
      tool: name,
      arguments: isRecord(args) ? args : undefined,
    });
    return jsonResponse(
      {
        jsonrpc: "2.0",
        id: payload?.id ?? null,
        result: {
          content: [
            {
              type: "content",
              content: {
                type: "text",
                text: JSON.stringify(output ?? {}),
              },
            },
          ],
        },
      },
      200,
    );
  });

  app.notFound(() => jsonResponse({ error: "Not found" }, 404));

  return app;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}
