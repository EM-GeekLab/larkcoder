import * as acp from "@agentclientprotocol/sdk"
import { createSseStream, type SseStreamOptions } from "./sseStream.js"

export type ACPClientOptions = {
  streamUrl: string
  sendUrl?: string
  headers?: Record<string, string>
  clientCapabilities?: acp.ClientCapabilities
  clientInfo?: acp.Implementation
  heartbeatIntervalMs?: number
  heartbeatTimeoutMs?: number
  retryDelayMs?: number
  maxRetries?: number
}

export type ToolCallResult = {
  sessionId: string
  toolCallId: string
  status: "completed" | "failed"
  output?: unknown
}

export type AgentClient = {
  initialize: () => Promise<acp.InitializeResponse>
  newSession: (params: acp.NewSessionRequest) => Promise<acp.NewSessionResponse>
  sendPrompt: (params: acp.PromptRequest) => Promise<acp.PromptResponse>
  interrupt: (params: acp.CancelNotification) => Promise<void>
  toolCallResult: (params: ToolCallResult) => Promise<acp.ExtResponse>
  readonly agentCapabilities?: acp.AgentCapabilities
  readonly clientCapabilities?: acp.ClientCapabilities
}

export class ACPClient {
  private connection?: acp.ClientSideConnection
  private options: ACPClientOptions
  private clientHandler: acp.Client
  private initializeResponse?: acp.InitializeResponse
  private negotiatedClientCapabilities?: acp.ClientCapabilities

  constructor(options: ACPClientOptions, clientHandler: acp.Client) {
    this.options = options
    this.clientHandler = clientHandler
  }

  async initialize(): Promise<acp.InitializeResponse> {
    const streamOptions: SseStreamOptions = {
      streamUrl: this.options.streamUrl,
    }

    if (this.options.sendUrl) {
      streamOptions.sendUrl = this.options.sendUrl
    }

    if (this.options.headers) {
      streamOptions.headers = this.options.headers
    }

    if (this.options.heartbeatIntervalMs !== undefined) {
      streamOptions.heartbeatIntervalMs = this.options.heartbeatIntervalMs
    }

    if (this.options.heartbeatTimeoutMs !== undefined) {
      streamOptions.heartbeatTimeoutMs = this.options.heartbeatTimeoutMs
    }

    if (this.options.retryDelayMs !== undefined) {
      streamOptions.retryDelayMs = this.options.retryDelayMs
    }

    if (this.options.maxRetries !== undefined) {
      streamOptions.maxRetries = this.options.maxRetries
    }

    const stream = createSseStream(streamOptions)
    this.connection = new acp.ClientSideConnection(
      () => this.clientHandler,
      stream,
    )

    const response = await this.connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: this.options.clientCapabilities ?? {},
      clientInfo: this.options.clientInfo ?? null,
    })

    this.initializeResponse = response
    this.negotiatedClientCapabilities = this.options.clientCapabilities ?? {}
    return response
  }

  async connect(): Promise<acp.InitializeResponse> {
    return await this.initialize()
  }

  async newSession(
    params: acp.NewSessionRequest,
  ): Promise<acp.NewSessionResponse> {
    return await this.requireConnection().newSession(params)
  }

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    return await this.requireConnection().prompt(params)
  }

  async sendPrompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    return await this.prompt(params)
  }

  async cancel(params: acp.CancelNotification): Promise<void> {
    await this.requireConnection().cancel(params)
  }

  async interrupt(params: acp.CancelNotification): Promise<void> {
    await this.cancel(params)
  }

  async toolCallResult(params: ToolCallResult): Promise<acp.ExtResponse> {
    return await this.requireConnection().extMethod(
      "autocoder/tool_call_result",
      params,
    )
  }

  get connectionClosed(): Promise<void> | undefined {
    return this.connection?.closed
  }

  get agentCapabilities(): acp.AgentCapabilities | undefined {
    return this.initializeResponse?.agentCapabilities
  }

  get clientCapabilities(): acp.ClientCapabilities | undefined {
    return this.negotiatedClientCapabilities
  }

  private requireConnection(): acp.ClientSideConnection {
    if (!this.connection) {
      throw new Error("ACP client is not connected")
    }
    return this.connection
  }
}
