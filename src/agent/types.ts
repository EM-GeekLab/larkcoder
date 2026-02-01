import type * as acp from "@agentclientprotocol/sdk"
import type { ChildProcess } from "node:child_process"

export type AgentClient = {
  initialize(): Promise<acp.InitializeResponse>
  newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse>
  resumeSession(
    params: acp.ResumeSessionRequest,
  ): Promise<acp.ResumeSessionResponse>
  prompt(params: acp.PromptRequest): Promise<acp.PromptResponse>
  cancel(params: acp.CancelNotification): Promise<void>
  setSessionMode(
    params: acp.SetSessionModeRequest,
  ): Promise<acp.SetSessionModeResponse>
  readonly signal: AbortSignal
  readonly closed: Promise<void>
}

export type SessionUpdateCallback = (
  params: acp.SessionNotification,
) => Promise<void>

export type ToolDefinition = {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export type ToolCallRequest = {
  tool: string
  arguments?: Record<string, unknown>
}

export type ToolHandler = (request: ToolCallRequest) => Promise<unknown>

export type AgentProcessInfo = {
  taskId: string
  process: ChildProcess
  pid: number
  kill: () => void
}
