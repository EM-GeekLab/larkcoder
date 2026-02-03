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

const AVAILABLE_MODES: acp.SessionMode[] = [
  { id: "default", name: "Default", description: "Normal mode with standard permissions" },
  { id: "acceptEdits", name: "Accept Edits", description: "Auto-accept file edits" },
  { id: "plan", name: "Plan", description: "Plan mode for reviewing before executing" },
  { id: "dontAsk", name: "Don't Ask", description: "Skip confirmation prompts" },
  {
    id: "bypassPermissions",
    name: "Bypass Permissions ⚡",
    description: "Bypass all permission checks",
  },
]

const DEFAULT_MODE_ID = AVAILABLE_MODES[0]!.id

const DEFAULT_THOUGHT_LEVEL = "concise"

function buildConfigOptions(thoughtLevel: string): acp.SessionConfigOption[] {
  return [
    {
      type: "select",
      id: "thought_level",
      name: "Thought Level",
      category: "thought_level",
      currentValue: thoughtLevel,
      options: [
        { value: "none", name: "None", description: "No thinking output" },
        { value: "concise", name: "Concise", description: "Brief thought summaries" },
        { value: "verbose", name: "Verbose", description: "Detailed thinking output" },
      ],
    },
  ]
}

interface AgentSession {
  pendingPrompt: AbortController | null
  cwd: string
  systemPrompt?: string
  currentModel: string
  currentMode: string
  currentThoughtLevel: string
}

type ToolCallOpts = {
  title: string
  kind: acp.ToolKind
  toolName?: string
  locations?: acp.ToolCallLocation[]
  rawInput?: unknown
  rawOutput?: unknown
  status?: "completed" | "failed"
  duration?: number
}

class MockAgent implements acp.Agent {
  private connection: acp.AgentSideConnection
  private sessions: Map<string, AgentSession>
  private callCounter = 0

  constructor(connection: acp.AgentSideConnection) {
    this.connection = connection
    this.sessions = new Map()
  }

  async initialize(_params: acp.InitializeRequest): Promise<acp.InitializeResponse> {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
        sessionCapabilities: {
          resume: {},
        },
      },
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
      currentMode: DEFAULT_MODE_ID,
      currentThoughtLevel: DEFAULT_THOUGHT_LEVEL,
    })

    return {
      sessionId,
      models: {
        availableModels: AVAILABLE_MODELS,
        currentModelId: DEFAULT_MODEL_ID,
      },
      modes: {
        availableModes: AVAILABLE_MODES,
        currentModeId: DEFAULT_MODE_ID,
      },
      configOptions: buildConfigOptions(DEFAULT_THOUGHT_LEVEL),
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
        currentMode: DEFAULT_MODE_ID,
        currentThoughtLevel: DEFAULT_THOUGHT_LEVEL,
      })
    }

    const session = this.sessions.get(sessionId)!

    return {
      models: {
        availableModels: AVAILABLE_MODELS,
        currentModelId: session.currentModel,
      },
      modes: {
        availableModes: AVAILABLE_MODES,
        currentModeId: session.currentMode,
      },
      configOptions: buildConfigOptions(session.currentThoughtLevel),
    }
  }

  async authenticate(_params: acp.AuthenticateRequest): Promise<acp.AuthenticateResponse | void> {
    return {}
  }

  async setSessionMode(params: acp.SetSessionModeRequest): Promise<acp.SetSessionModeResponse> {
    const session = this.sessions.get(params.sessionId)
    if (!session) {
      throw new Error(`Session ${params.sessionId} not found`)
    }

    if (!AVAILABLE_MODES.some((m) => m.id === params.modeId)) {
      throw new Error(`Unknown mode: ${params.modeId}`)
    }

    session.currentMode = params.modeId

    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "current_mode_update",
        currentModeId: params.modeId,
      },
    })

    return {}
  }

  async unstable_setSessionConfigOption(
    params: acp.SetSessionConfigOptionRequest,
  ): Promise<acp.SetSessionConfigOptionResponse> {
    const session = this.sessions.get(params.sessionId)
    if (!session) {
      throw new Error(`Session ${params.sessionId} not found`)
    }

    if (params.configId === "thought_level") {
      const validValues = ["none", "concise", "verbose"]
      if (!validValues.includes(params.value)) {
        throw new Error(`Invalid value for thought_level: ${params.value}`)
      }
      session.currentThoughtLevel = params.value
    } else {
      throw new Error(`Unknown config option: ${params.configId}`)
    }

    const configOptions = buildConfigOptions(session.currentThoughtLevel)

    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "config_option_update",
        configOptions,
      },
    })

    return { configOptions }
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

  // ── Helpers ──────────────────────────────────────────────────

  private nextCallId(): string {
    return `call_${++this.callCounter}`
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) =>
      setTimeout(() => {
        if (signal.aborted) {
          reject(new Error("Aborted"))
        } else {
          resolve()
        }
      }, ms),
    )
  }

  private async textChunk(sessionId: string, text: string): Promise<void> {
    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    })
  }

  private async thoughtChunk(sessionId: string, text: string): Promise<void> {
    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text },
      },
    })
  }

  private async toolCall(
    sessionId: string,
    opts: ToolCallOpts,
    signal: AbortSignal,
  ): Promise<void> {
    const id = this.nextCallId()
    const meta = opts.toolName ? { claudeCode: { toolName: opts.toolName } } : undefined

    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: id,
        title: opts.title,
        kind: opts.kind,
        status: "pending",
        ...(opts.locations && { locations: opts.locations }),
        ...(opts.rawInput != null && { rawInput: opts.rawInput }),
        ...(meta && { _meta: meta }),
      },
    })

    await this.sleep(opts.duration ?? 800, signal)

    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: id,
        status: opts.status ?? "completed",
        ...(opts.rawOutput != null && { rawOutput: opts.rawOutput }),
      },
    })
  }

  // ── Simulation ───────────────────────────────────────────────

  private async simulateTurn(sessionId: string, signal: AbortSignal): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }

    const cwd = session.cwd

    // 1. Thinking
    await this.thoughtChunk(sessionId, "用户想要了解项目情况，我需要先读取文件结构，")
    await this.sleep(300, signal)
    await this.thoughtChunk(sessionId, "然后搜索关键代码，最后做出修改。")
    await this.sleep(500, signal)

    // 2. Text
    await this.textChunk(sessionId, "我正在分析项目结构，让我先查看相关文件...\n\n")
    await this.sleep(300, signal)

    // 3. Read (kind: read) — title 固定为 "Read File"，路径在 locations
    await this.toolCall(
      sessionId,
      {
        title: "Read File",
        kind: "read",
        toolName: "Read",
        locations: [{ path: `${cwd}/README.md` }],
        rawInput: { file_path: `${cwd}/README.md` },
        rawOutput: { content: "# LarkCoder\n\n通过飞书 IM 消息控制 Claude Code。" },
      },
      signal,
    )

    // 4. Grep (kind: search) — title 小写 "grep"
    await this.toolCall(
      sessionId,
      {
        title: `grep "export.*function" ${cwd}/src/index.ts`,
        kind: "search",
        toolName: "Grep",
        rawInput: { pattern: "export.*function", path: `${cwd}/src/index.ts` },
        rawOutput: { matches: ["export function main()"] },
      },
      signal,
    )

    // 5. Glob/Find (kind: search)
    await this.toolCall(
      sessionId,
      {
        title: `Find ${cwd}/src **/*.ts`,
        kind: "search",
        toolName: "Glob",
        rawInput: { pattern: "**/*.ts", path: `${cwd}/src` },
        rawOutput: { files: ["index.ts", "config.ts", "utils.ts"] },
      },
      signal,
    )

    await this.textChunk(sessionId, "找到了相关文件。让我搜索一些文档...\n\n")
    await this.sleep(300, signal)

    // 6. WebFetch (kind: fetch)
    await this.toolCall(
      sessionId,
      {
        title: "Fetch https://docs.example.com/api",
        kind: "fetch",
        toolName: "WebFetch",
        rawInput: { url: "https://docs.example.com/api", prompt: "Extract API docs" },
        rawOutput: { content: "API documentation content..." },
        duration: 2000,
      },
      signal,
    )

    // 7. WebSearch (kind: fetch) — title 不含 "Search" 前缀
    await this.toolCall(
      sessionId,
      {
        title: '"Bun runtime API 2026"',
        kind: "fetch",
        toolName: "WebSearch",
        rawInput: { query: "Bun runtime API 2026" },
        rawOutput: { results: [{ title: "Bun docs", url: "https://bun.sh" }] },
        duration: 1500,
      },
      signal,
    )

    // 8. Think (kind: think)
    await this.toolCall(
      sessionId,
      {
        title: "Thinking",
        kind: "think",
        rawInput: { thought: "分析最佳实现方案..." },
        rawOutput: { thought: "应该使用模块化架构" },
        duration: 1200,
      },
      signal,
    )

    // 9. Bash success (kind: execute)
    await this.toolCall(
      sessionId,
      {
        title: "Run `bun run check`",
        kind: "execute",
        toolName: "Bash",
        rawInput: { command: "bun run check" },
        rawOutput: { exitCode: 0, stdout: "No errors found." },
        duration: 3000,
      },
      signal,
    )

    // 10. Bash failure (kind: execute)
    await this.toolCall(
      sessionId,
      {
        title: "Run `bun run test`",
        kind: "execute",
        toolName: "Bash",
        rawInput: { command: "bun run test" },
        rawOutput: { exitCode: 1, stderr: "FAIL src/utils.test.ts" },
        status: "failed",
        duration: 2000,
      },
      signal,
    )

    await this.textChunk(sessionId, "类型检查通过，但测试有失败。现在进行修改...\n\n")
    await this.sleep(300, signal)

    // 11. Write (kind: edit) — 需要权限
    const writeCallId = this.nextCallId()
    const writePath = `${cwd}/src/config.ts`
    const writeMeta = { claudeCode: { toolName: "Write" } }

    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: writeCallId,
        title: `Write ${writePath}`,
        kind: "edit",
        status: "pending",
        _meta: writeMeta,
        locations: [{ path: writePath }],
        rawInput: {
          file_path: writePath,
          content: 'export const VERSION = "0.2.0";\n',
        },
      },
    })

    const permissionResponse = await this.connection.requestPermission({
      sessionId,
      toolCall: {
        toolCallId: writeCallId,
        title: `Write ${writePath}`,
        kind: "edit",
        status: "pending",
        locations: [{ path: writePath }],
        rawInput: {
          file_path: writePath,
          content: 'export const VERSION = "0.2.0";\n',
        },
      },
      options: [
        { kind: "allow_once", name: "允许此更改", optionId: "allow" },
        { kind: "reject_once", name: "跳过此更改", optionId: "reject" },
      ],
    })

    if (permissionResponse.outcome.outcome === "cancelled") {
      await this.textChunk(sessionId, "权限请求已取消。")
      return
    }

    switch (permissionResponse.outcome.optionId) {
      case "allow": {
        await this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: writeCallId,
            status: "completed",
            rawOutput: { success: true },
          },
        })

        await this.sleep(300, signal)

        // 12. Delete (kind: delete)
        await this.toolCall(
          sessionId,
          {
            title: `Delete ${cwd}/src/config.old.ts`,
            kind: "delete",
            rawInput: { path: `${cwd}/src/config.old.ts` },
            rawOutput: { success: true },
            duration: 500,
          },
          signal,
        )

        // 13. Move (kind: move)
        await this.toolCall(
          sessionId,
          {
            title: `Rename ${cwd}/temp.ts → ${cwd}/src/utils.ts`,
            kind: "move",
            rawInput: { from: `${cwd}/temp.ts`, to: `${cwd}/src/utils.ts` },
            rawOutput: { success: true },
            duration: 500,
          },
          signal,
        )

        await this.textChunk(sessionId, "完成！所有更改已成功应用。")
        break
      }
      case "reject": {
        await this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: writeCallId,
            status: "failed",
          },
        })

        await this.sleep(300, signal)
        await this.textChunk(sessionId, "好的，已跳过文件修改。")
        break
      }
      default:
        throw new Error(
          `Unexpected permission outcome ${JSON.stringify(permissionResponse.outcome)}`,
        )
    }
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
