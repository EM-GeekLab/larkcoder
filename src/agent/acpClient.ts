import type * as acp from "@agentclientprotocol/sdk"
import { ClientSideConnection } from "@agentclientprotocol/sdk"
import type { Logger } from "../utils/logger.js"
import type {
  AgentClient,
  SessionUpdateCallback,
  ToolDefinition,
  ToolHandler,
} from "./types.js"
import { ClientBridge } from "./clientBridge.js"
import { createSseStream } from "./sseStream.js"

export type CreateAcpClientOptions = {
  port: number
  logger: Logger
  onSessionUpdate: SessionUpdateCallback
  tools?: Array<{ definition: ToolDefinition; handler: ToolHandler }>
}

export function createAcpClient(options: CreateAcpClientOptions): AgentClient {
  const { port, logger, onSessionUpdate, tools } = options

  const streamUrl = `http://127.0.0.1:${port}/sse`
  const sendUrl = `http://127.0.0.1:${port}/message`

  const abortController = new AbortController()

  const bridge = new ClientBridge(logger)
  bridge.onSessionUpdate(onSessionUpdate)

  if (tools) {
    for (const { definition, handler } of tools) {
      bridge.registerTool(definition, handler)
    }
  }

  const stream = createSseStream({
    streamUrl,
    sendUrl,
    signal: abortController.signal,
    logger,
  })

  const connection = new ClientSideConnection(() => bridge, stream)

  return {
    async initialize() {
      return connection.initialize({
        clientInfo: { name: "larkcoder", version: "0.1.0" },
        protocolVersion: 1,
      })
    },
    async newSession(params: acp.NewSessionRequest) {
      return connection.newSession(params)
    },
    async resumeSession(params: acp.ResumeSessionRequest) {
      return connection.unstable_resumeSession(params)
    },
    async prompt(params: acp.PromptRequest) {
      return connection.prompt(params)
    },
    async cancel(params: acp.CancelNotification) {
      return connection.cancel(params)
    },
    get signal() {
      return connection.signal
    },
    get closed() {
      return connection.closed
    },
  }
}
