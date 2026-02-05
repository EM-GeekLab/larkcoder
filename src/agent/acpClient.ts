import type { ChildProcess } from 'node:child_process'
import * as acp from '@agentclientprotocol/sdk'
import { Readable, Writable } from 'node:stream'
import type { Logger } from '../utils/logger'
import type {
  AgentClient,
  PermissionRequestCallback,
  SessionUpdateCallback,
  ToolDefinition,
  ToolHandler,
} from './types'
import { ClientBridge } from './clientBridge'

export type CreateAcpClientOptions = {
  process: ChildProcess
  logger: Logger
  onSessionUpdate: SessionUpdateCallback
  onPermissionRequest?: PermissionRequestCallback
  tools?: Array<{ definition: ToolDefinition; handler: ToolHandler }>
}

export function createAcpClient(options: CreateAcpClientOptions): AgentClient {
  const { process: child, logger, onSessionUpdate, onPermissionRequest, tools } = options

  if (!child.stdin || !child.stdout) {
    throw new Error('Agent process must have piped stdin and stdout')
  }

  const bridge = new ClientBridge(logger)
  bridge.onSessionUpdate(onSessionUpdate)

  if (onPermissionRequest) {
    bridge.onPermissionRequest(onPermissionRequest)
  }

  if (tools) {
    for (const { definition, handler } of tools) {
      bridge.registerTool(definition, handler)
    }
  }

  const toAgent = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>
  const fromAgent = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
  const stream = acp.ndJsonStream(toAgent, fromAgent)

  const connection = new acp.ClientSideConnection(() => bridge, stream)

  return {
    async initialize() {
      return connection.initialize({
        clientInfo: { name: 'larkcoder', version: '0.1.0' },
        protocolVersion: acp.PROTOCOL_VERSION,
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
    async setSessionMode(params: acp.SetSessionModeRequest) {
      return connection.setSessionMode(params)
    },
    async setSessionModel(params: { sessionId: string; modelId: string }) {
      return connection.unstable_setSessionModel(params)
    },
    async setSessionConfigOption(params: { sessionId: string; configId: string; value: string }) {
      return connection.unstable_setSessionConfigOption(params)
    },
    get signal() {
      return connection.signal
    },
    get closed() {
      return connection.closed
    },
  }
}
