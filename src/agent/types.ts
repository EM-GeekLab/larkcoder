import type * as acp from "@agentclientprotocol/sdk"

export type AgentClient = {
  initialize(): Promise<acp.InitializeResponse>
  newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse>
  resumeSession(
    params: acp.ResumeSessionRequest,
  ): Promise<acp.ResumeSessionResponse>
  prompt(params: acp.PromptRequest): Promise<acp.PromptResponse>
  cancel(params: acp.CancelNotification): Promise<void>
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
  port: number
  pid: number
  kill: () => void
}
