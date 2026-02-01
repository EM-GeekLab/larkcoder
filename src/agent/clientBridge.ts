import type * as acp from "@agentclientprotocol/sdk"
import type { Logger } from "../utils/logger.js"
import type {
  SessionUpdateCallback,
  ToolCallRequest,
  ToolDefinition,
  ToolHandler,
} from "./types.js"

const TOOL_LIST_METHOD = "autocoder/tool/list"
const TOOL_CALL_METHOD = "autocoder/tool/call"

export class ClientBridge implements acp.Client {
  private tools = new Map<string, ToolHandler>()
  private toolDefinitions = new Map<string, ToolDefinition>()
  private onSessionUpdateCallback?: SessionUpdateCallback

  constructor(private logger: Logger) {}

  onSessionUpdate(callback: SessionUpdateCallback): void {
    this.onSessionUpdateCallback = callback
  }

  registerTool(definition: ToolDefinition, handler: ToolHandler): void {
    this.toolDefinitions.set(definition.name, definition)
    this.tools.set(definition.name, handler)
  }

  listTools(): ToolDefinition[] {
    return [...this.toolDefinitions.values()]
  }

  async sessionUpdate(params: acp.SessionNotification): Promise<void> {
    const updateType = (params.update as Record<string, unknown> | undefined)
      ?.sessionUpdate as string | undefined
    this.logger
      .withMetadata({ updateType })
      .trace("ClientBridge received session update")
    await this.onSessionUpdateCallback?.(params)
  }

  async requestPermission(
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    const option = params.options[0]
    if (!option) {
      return { outcome: { outcome: "cancelled" } }
    }
    this.logger.info(`Auto-approving permission: ${option.optionId}`)
    return {
      outcome: { outcome: "selected", optionId: option.optionId },
    }
  }

  async extMethod(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (method === TOOL_LIST_METHOD) {
      return { tools: this.listTools() }
    }

    if (method === TOOL_CALL_METHOD) {
      const request: ToolCallRequest = {
        tool: params.tool as string,
        arguments: params.arguments as Record<string, unknown> | undefined,
      }

      const handler = this.tools.get(request.tool)
      if (!handler) {
        throw new Error(`Unknown tool: ${request.tool}`)
      }

      const result = await handler(request)
      return { result: result as Record<string, unknown> }
    }

    throw new Error(`Unsupported ext method: ${method}`)
  }

  async extNotification(
    method: string,
    _params: Record<string, unknown>,
  ): Promise<void> {
    this.logger.info(`Ext notification: ${method}`)
  }
}
