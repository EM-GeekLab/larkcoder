import type * as acp from "@agentclientprotocol/sdk"
import type { Logger } from "../utils/logger.js"

export type ToolDefinition = {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export type ToolCallRequest = {
  tool: string
  arguments?: Record<string, unknown>
  context?: Record<string, unknown>
}

export type ToolHandler = (request: ToolCallRequest) => Promise<unknown>

export type ClientBridgeOptions = {
  logger: Logger
  onSessionUpdate?: (params: acp.SessionNotification) => Promise<void> | void
  tools?: Record<string, ToolHandler>
  toolDefinitions?: ToolDefinition[]
}

const TOOL_CALL_METHOD = "autocoder/tool/call"
const TOOL_LIST_METHOD = "autocoder/tool/list"

export class ClientBridge implements acp.Client {
  private logger: Logger
  private onSessionUpdate?: (
    params: acp.SessionNotification,
  ) => Promise<void> | void
  private tools = new Map<string, ToolHandler>()
  private toolDefinitions = new Map<string, ToolDefinition>()

  constructor(options: ClientBridgeOptions) {
    this.logger = options.logger
    this.onSessionUpdate = options.onSessionUpdate

    if (options.toolDefinitions) {
      for (const definition of options.toolDefinitions) {
        this.toolDefinitions.set(definition.name, definition)
      }
    }

    if (options.tools) {
      for (const [name, handler] of Object.entries(options.tools)) {
        this.registerTool({ name }, handler)
      }
    }
  }

  registerTool(definition: ToolDefinition, handler: ToolHandler): void {
    this.toolDefinitions.set(definition.name, definition)
    this.tools.set(definition.name, handler)
  }

  listTools(): ToolDefinition[] {
    return Array.from(this.toolDefinitions.values())
  }

  async callTool(payload: ToolCallRequest): Promise<unknown> {
    const handler = this.tools.get(payload.tool)
    if (!handler) {
      throw new Error(`Tool not registered: ${payload.tool}`)
    }
    return await handler(payload)
  }

  async requestPermission(
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    const option = params.options[0]
    if (!option) {
      return { outcome: { outcome: "cancelled" } }
    }

    return {
      outcome: {
        outcome: "selected",
        optionId: option.optionId,
      },
    }
  }

  async sessionUpdate(params: acp.SessionNotification): Promise<void> {
    await this.onSessionUpdate?.(params)
    this.logger
      .withMetadata({
        type: params.update.sessionUpdate,
        sessionId: params.sessionId,
      })
      .info("Session update")
  }

  async extMethod(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (method === TOOL_LIST_METHOD) {
      return { tools: this.listTools() }
    }

    if (method === TOOL_CALL_METHOD) {
      const payload = parseToolCallRequest(params)
      const result = await this.callTool(payload)
      return { result }
    }

    throw new Error(`Unsupported ext method: ${method}`)
  }

  async extNotification(
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    this.logger
      .withMetadata({ method, params })
      .info("Ext notification received")
  }
}

function parseToolCallRequest(
  params: Record<string, unknown>,
): ToolCallRequest {
  const tool = params.tool
  if (typeof tool !== "string" || tool.length === 0) {
    throw new Error("Tool call missing tool name")
  }

  const args = params.arguments
  const context = params.context

  return {
    tool,
    arguments: isRecord(args) ? args : undefined,
    context: isRecord(context) ? context : undefined,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
