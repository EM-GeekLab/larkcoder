#!/usr/bin/env bun

import * as acp from "@agentclientprotocol/sdk"
import { Readable, Writable } from "node:stream"

const AVAILABLE_MODELS: acp.ModelInfo[] = [
  { modelId: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
  { modelId: "claude-opus-4-20250514", name: "Claude Opus 4" },
  { modelId: "claude-opus-4-5-20251101", name: "Claude Opus 4.5" },
  { modelId: "claude-haiku-3-5-20241022", name: "Claude Haiku 3.5" },
  { modelId: "claude-sonnet-3-5-20241022", name: "Claude Sonnet 3.5" },
]

const DEFAULT_MODEL_ID = AVAILABLE_MODELS[0]!.modelId

interface AgentSession {
  pendingPrompt: AbortController | null
  cwd: string
  systemPrompt?: string
  currentModel: string
}

class MockAgent implements acp.Agent {
  private connection: acp.AgentSideConnection
  private sessions: Map<string, AgentSession>

  constructor(connection: acp.AgentSideConnection) {
    this.connection = connection
    this.sessions = new Map()
  }

  async initialize(_params: acp.InitializeRequest): Promise<acp.InitializeResponse> {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
        resume: {}, // Support session resume capability
      } as acp.AgentCapabilities,
    }
  }

  async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    const sessionId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")

    this.sessions.set(sessionId, {
      pendingPrompt: null,
      cwd: params.cwd ?? process.cwd(),
      systemPrompt: (params._meta as { systemPrompt?: string } | undefined)?.systemPrompt,
      currentModel: DEFAULT_MODEL_ID,
    })

    return {
      sessionId,
      models: {
        availableModels: AVAILABLE_MODELS,
        currentModelId: DEFAULT_MODEL_ID,
      },
    }
  }

  async unstable_resumeSession(
    params: acp.ResumeSessionRequest,
  ): Promise<acp.ResumeSessionResponse> {
    const sessionId = params.sessionId

    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        pendingPrompt: null,
        cwd: params.cwd ?? process.cwd(),
        systemPrompt: (params._meta as { systemPrompt?: string } | undefined)?.systemPrompt,
        currentModel: DEFAULT_MODEL_ID,
      })
    }

    const session = this.sessions.get(sessionId)!

    return {
      models: {
        availableModels: AVAILABLE_MODELS,
        currentModelId: session.currentModel,
      },
    }
  }

  async authenticate(_params: acp.AuthenticateRequest): Promise<acp.AuthenticateResponse | void> {
    // No auth needed - return empty response
    return {}
  }

  async setSessionMode(_params: acp.SetSessionModeRequest): Promise<acp.SetSessionModeResponse> {
    return {}
  }

  async unstable_setSessionModel(
    params: acp.SetSessionModelRequest,
  ): Promise<acp.SetSessionModelResponse> {
    const session = this.sessions.get(params.sessionId)

    if (!session) {
      throw new Error(`Session ${params.sessionId} not found`)
    }

    if (!AVAILABLE_MODELS.some((m) => m.modelId === params.modelId)) {
      throw new Error(`Unknown model: ${params.modelId}`)
    }

    session.currentModel = params.modelId
    return {}
  }

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const session = this.sessions.get(params.sessionId)

    if (!session) {
      throw new Error(`Session ${params.sessionId} not found`)
    }

    session.pendingPrompt?.abort()
    session.pendingPrompt = new AbortController()

    try {
      await this.simulateTurn(params.sessionId, session.pendingPrompt.signal)
    } catch (err) {
      if (session.pendingPrompt.signal.aborted) {
        return { stopReason: "cancelled" }
      }

      throw err
    }

    session.pendingPrompt = null

    return {
      stopReason: "end_turn",
    }
  }

  private async simulateTurn(sessionId: string, abortSignal: AbortSignal): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }

    // Send initial text chunk
    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "我正在处理您的请求。让我先了解一下当前的情况...",
        },
      },
    })

    await this.simulateModelInteraction(abortSignal)

    // Send a tool call that doesn't need permission (read operation)
    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_1",
        title: "读取项目文件",
        kind: "read",
        status: "pending",
        locations: [{ path: `${session.cwd}/README.md` }],
        rawInput: { path: `${session.cwd}/README.md` },
      },
    })

    await this.simulateModelInteraction(abortSignal)

    // Update tool call to completed
    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call_1",
        status: "completed",
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: "# LarkCoder\n\n通过飞书 IM 消息控制 Claude Code (ACP Server)。",
            },
          },
        ],
        rawOutput: {
          content: "# LarkCoder\n\n通过飞书 IM 消息控制 Claude Code (ACP Server)。",
        },
      },
    })

    await this.simulateModelInteraction(abortSignal)

    // Send more text
    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: " 我已经了解了项目结构。现在我需要做一些改进。",
        },
      },
    })

    await this.simulateModelInteraction(abortSignal)

    // Send a tool call that DOES need permission (edit operation)
    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_2",
        title: "修改配置文件",
        kind: "edit",
        status: "pending",
        locations: [{ path: `${session.cwd}/config.json` }],
        rawInput: {
          path: `${session.cwd}/config.json`,
          content: '{"version": "0.2.0"}',
        },
      },
    })

    // Request permission for the sensitive operation
    const permissionResponse = await this.connection.requestPermission({
      sessionId,
      toolCall: {
        toolCallId: "call_2",
        title: "修改配置文件",
        kind: "edit",
        status: "pending",
        locations: [{ path: `${session.cwd}/config.json` }],
        rawInput: {
          path: `${session.cwd}/config.json`,
          content: '{"version": "0.2.0"}',
        },
      },
      options: [
        {
          kind: "allow_once",
          name: "允许此更改",
          optionId: "allow",
        },
        {
          kind: "reject_once",
          name: "跳过此更改",
          optionId: "reject",
        },
      ],
    })

    if (permissionResponse.outcome.outcome === "cancelled") {
      await this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: " 权限请求已取消。",
          },
        },
      })
      return
    }

    switch (permissionResponse.outcome.optionId) {
      case "allow": {
        await this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "call_2",
            status: "completed",
            rawOutput: {
              success: true,
              message: "配置文件已更新",
            },
          },
        })

        await this.simulateModelInteraction(abortSignal)

        await this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: " 完成！我已经成功更新了配置文件。更改已应用。",
            },
          },
        })
        break
      }
      case "reject": {
        await this.simulateModelInteraction(abortSignal)

        await this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: " 我理解您不想进行此更改。我将跳过配置文件的更新。",
            },
          },
        })
        break
      }
      default:
        throw new Error(
          `Unexpected permission outcome ${JSON.stringify(permissionResponse.outcome)}`,
        )
    }
  }

  private simulateModelInteraction(abortSignal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) =>
      setTimeout(() => {
        // In a real agent, you'd pass this abort signal to the LLM client
        if (abortSignal.aborted) {
          reject(new Error("Aborted"))
        } else {
          resolve()
        }
      }, 1000),
    )
  }

  async cancel(params: acp.CancelNotification): Promise<void> {
    this.sessions.get(params.sessionId)?.pendingPrompt?.abort()
  }
}

// Main entry point
const input = Writable.toWeb(process.stdout)
const output = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>

const stream = acp.ndJsonStream(input, output)
new acp.AgentSideConnection((conn) => new MockAgent(conn), stream)
