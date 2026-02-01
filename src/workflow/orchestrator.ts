import type * as acp from "@agentclientprotocol/sdk"
import type { AgentClient } from "../acp/acpClient.js"
import type { ToolDefinition, ToolHandler } from "../acp/clientBridge.js"
import type {
  AgentContainer,
  ContainerOrchestratorClient,
} from "../container/orchestrator.js"
import type { LarkClient } from "../lark/larkClient.js"
import type { GithubWebhookEvent } from "../vcs/githubWebhook.js"
import type { StateStore } from "./store.js"
import type {
  TaskData,
  TaskRecord,
  WorkflowLogEntry,
  WorkflowState,
} from "./types.js"
import { extractPlanFromMarkdown } from "../lark/docContext.js"
import {
  buildWorkflowCard,
  type WorkflowTelemetry,
} from "../lark/messageCard.js"
import { createLogger, type Logger } from "../utils/logger.js"

const transitions: Record<WorkflowState, WorkflowState[]> = {
  Idle: ["Planning"],
  Planning: ["Coding"],
  Coding: ["Reviewing", "Completed"],
  Reviewing: ["Coding", "Completed"],
  Completed: [],
}

const MAX_SOLO_TURNS = 5
const TELEMETRY_THROTTLE_MS = 2000

type ActiveTask = {
  taskId: string
  container: AgentContainer
  acpClient: AgentClient
  sessionId: string
  pendingPrompt?: PromptCollector
  stopLogStream?: () => void
  lastTelemetryAt?: number
  latestTelemetry?: WorkflowTelemetry
}

type PromptCollector = {
  chunks: string[]
}

export type AgentClientFactoryOptions = {
  taskId: string
  data?: TaskData
  onSessionUpdate: (params: acp.SessionNotification) => Promise<void> | void
  toolDefinitions: ToolDefinition[]
  toolHandlers: Record<string, ToolHandler>
}

export type AgentClientFactory = (
  options: AgentClientFactoryOptions,
) => AgentClient

export type WorkflowOrchestratorOptions = {
  containerOrchestrator: ContainerOrchestratorClient
  acpClientFactory: AgentClientFactory
  larkClient?: LarkClient
  mcpServerBaseUrl?: string
  githubClient?: {
    createPullRequest: (request: {
      title: string
      body?: string
      head: string
      base: string
      draft?: boolean
      repository?: string
    }) => Promise<{ url: string }>
    defaultBaseBranch?: string
  }
  logger?: Logger
}

export class WorkflowOrchestrator {
  private logger: Logger
  private activeTasks = new Map<string, ActiveTask>()

  constructor(
    private store: StateStore,
    private options: WorkflowOrchestratorOptions,
  ) {
    this.logger =
      options.logger ?? createLogger({ prefix: "WorkflowOrchestrator" })
  }

  async createTask(taskId: string, data?: TaskData): Promise<TaskRecord> {
    const now = new Date().toISOString()
    const record: TaskRecord = {
      taskId,
      state: "Idle",
      createdAt: now,
      updatedAt: now,
    }

    if (data) {
      record.data = data
    }

    await this.store.set(record)
    return record
  }

  async getTask(taskId: string): Promise<TaskRecord | null> {
    return await this.store.get(taskId)
  }

  async resolveTaskIdByDocToken(docToken: string): Promise<string | null> {
    return (await this.store.getTaskIdByDocToken?.(docToken)) ?? null
  }

  async transition(
    taskId: string,
    nextState: WorkflowState,
  ): Promise<TaskRecord> {
    const record = await this.requireTask(taskId)
    const allowed = transitions[record.state]
    if (!allowed.includes(nextState)) {
      throw new Error(`Invalid transition from ${record.state} to ${nextState}`)
    }

    const updated = await this.updateTask(
      taskId,
      (data) => ({
        ...data,
      }),
      nextState,
    )

    this.logger
      .withMetadata({ taskId, from: record.state, to: nextState })
      .info("Workflow transition")
    return updated
  }

  async handleDocContext(
    taskId: string,
    markdown: string,
    docToken?: string,
  ): Promise<TaskRecord> {
    const record = await this.ensureTask(
      taskId,
      docToken ? { docToken } : undefined,
    )
    const planContext = extractPlanFromMarkdown(markdown)

    const updated = await this.updateTask(taskId, (data) => ({
      ...data,
      docToken: docToken ?? data.docToken,
      planMarkdown: markdown,
      planContext,
    }))
    if (docToken) {
      await this.store.setDocTokenMapping?.(docToken, taskId)
    }

    let state = updated.state
    if (record.state === "Idle") {
      const transitioned = await this.transition(taskId, "Planning")
      state = transitioned.state
    }

    await this.sendWorkflowCard(
      taskId,
      state,
      planContext,
      updated.data?.pr?.url,
      this.activeTasks.get(taskId)?.latestTelemetry,
    )
    return updated
  }

  async handleLarkComment(
    taskId: string,
    comment: string,
  ): Promise<string | null> {
    const record = await this.ensureTask(taskId)
    const planContext = record.data?.planContext ?? record.data?.planMarkdown
    const prompt = buildCommentPrompt(planContext, comment)

    const active = await this.ensureSession(taskId)
    const { responseText } = await this.runPrompt(taskId, active, prompt)

    return responseText.trim().length > 0 ? responseText : null
  }

  async startCoding(taskId: string): Promise<TaskRecord> {
    const record = await this.ensureTask(taskId)
    const planContext = record.data?.planContext ?? record.data?.planMarkdown
    if (!planContext) {
      throw new Error("Plan context missing for coding session")
    }

    const active = await this.ensureSession(taskId)
    if (record.state === "Idle") {
      await this.transition(taskId, "Planning")
    }
    await this.transitionIfAllowed(taskId, "Coding")

    await this.sendWorkflowCard(
      taskId,
      "Coding",
      planContext,
      record.data?.pr?.url,
    )
    void this.runSoloLoop(taskId, active, planContext)
    return await this.requireTask(taskId)
  }

  async handleGithubEvent(event: GithubWebhookEvent): Promise<void> {
    if (
      event.type === "check_run" ||
      event.type === "check_suite" ||
      event.type === "status"
    ) {
      const task = await this.findTaskByBranch(event.headRef)
      if (!task) {
        return
      }
      await this.updateTask(task.taskId, (data) => ({
        ...data,
        ci: {
          status: event.status,
          conclusion: event.conclusion,
          updatedAt: new Date().toISOString(),
        },
      }))
      return
    }

    if (
      event.type !== "pull_request_review" &&
      event.type !== "pull_request_review_comment" &&
      event.type !== "issue_comment"
    ) {
      if (event.type === "push") {
        const task = await this.findTaskByBranch(event.headRef)
        if (!task || task.data?.pr?.url) {
          return
        }
        await this.handlePullRequestRequest(task.taskId, {
          base: task.data?.githubBaseBranch,
          head: task.data?.branchName ?? task.data?.githubHeadBranch,
          repository: task.data?.githubRepository,
        })
      }
      return
    }

    const feedback = event.body?.trim()
    if (!feedback) {
      return
    }

    const task = await this.findTaskByBranch(event.headRef)
    if (!task) {
      this.logger
        .withMetadata({ eventType: event.type })
        .warn("No task matched GitHub event")
      return
    }

    await this.transitionIfAllowed(task.taskId, "Reviewing")
    const active = await this.ensureSession(task.taskId)
    const prompt = buildReviewPrompt(feedback, event)
    void this.runSoloLoop(task.taskId, active, prompt)
  }

  async shutdownTask(taskId: string): Promise<void> {
    const active = this.activeTasks.get(taskId)
    if (!active) {
      return
    }

    active.stopLogStream?.()
    await this.options.containerOrchestrator.stopAgent(active.container.name)
    this.activeTasks.delete(taskId)
  }

  private async ensureTask(
    taskId: string,
    data?: TaskData,
  ): Promise<TaskRecord> {
    const existing = await this.store.get(taskId)
    if (existing) {
      return existing
    }
    return await this.createTask(taskId, data)
  }

  private async requireTask(taskId: string): Promise<TaskRecord> {
    const record = await this.store.get(taskId)
    if (!record) {
      throw new Error(`Task ${taskId} not found`)
    }
    return record
  }

  private async updateTask(
    taskId: string,
    update: (data: TaskData) => TaskData,
    nextState?: WorkflowState,
  ): Promise<TaskRecord> {
    const record = await this.requireTask(taskId)
    const now = new Date().toISOString()
    const updated: TaskRecord = {
      ...record,
      state: nextState ?? record.state,
      updatedAt: now,
      data: update(record.data ?? {}),
    }
    await this.store.set(updated)
    return updated
  }

  private async transitionIfAllowed(
    taskId: string,
    nextState: WorkflowState,
  ): Promise<void> {
    const record = await this.requireTask(taskId)
    if (record.state === nextState) {
      return
    }

    const allowed = transitions[record.state]
    if (!allowed.includes(nextState)) {
      return
    }

    await this.transition(taskId, nextState)
  }

  private async ensureSession(taskId: string): Promise<ActiveTask> {
    const existing = this.activeTasks.get(taskId)
    if (existing) {
      return existing
    }

    const record = await this.requireTask(taskId)
    const container = await this.options.containerOrchestrator.launchAgent({
      taskId,
      repoUrl: record.data?.repoUrl,
      branchName: record.data?.branchName,
      authVolume: record.data?.authVolume,
      agentConfig: record.data?.agentConfig,
      variables: record.data?.variables,
    })

    const { toolDefinitions, toolHandlers } = this.buildToolRegistry(taskId)
    const mcpServers = buildMcpServers(
      taskId,
      toolDefinitions,
      this.options.mcpServerBaseUrl,
    )
    const acpClient = this.options.acpClientFactory({
      taskId,
      data: {
        ...record.data,
        agentHost: container.host ?? record.data?.agentHost,
        agentPort: container.hostPort ?? record.data?.agentPort,
      },
      onSessionUpdate: (params) => this.handleSessionUpdate(taskId, params),
      toolDefinitions,
      toolHandlers,
    })

    await acpClient.initialize()
    const session = await acpClient.newSession({
      cwd: container.workingDir ?? record.data?.workingDir ?? "/",
      mcpServers,
    })

    const active: ActiveTask = {
      taskId,
      container,
      acpClient,
      sessionId: session.sessionId,
    }

    this.activeTasks.set(taskId, active)

    await this.updateTask(taskId, (data) => ({
      ...data,
      containerName: container.name,
      containerId: container.id,
      workingDir: container.workingDir ?? data.workingDir,
      agentHost: container.host ?? data.agentHost,
      agentPort: container.hostPort ?? data.agentPort,
      sessionId: session.sessionId,
      agentCapabilities: acpClient.agentCapabilities,
      clientCapabilities: acpClient.clientCapabilities,
    }))

    await this.attachContainerLogs(taskId, container)
    return active
  }

  private async attachContainerLogs(
    taskId: string,
    container: AgentContainer,
  ): Promise<void> {
    try {
      const handle = await this.options.containerOrchestrator.streamAgentLogs(
        container.name,
      )
      handle.stream.on("data", (chunk) => {
        const text = chunk.toString().trim()
        if (!text) {
          return
        }
        this.logger
          .withMetadata({ taskId, container: container.name })
          .info(text)
      })
      const active = this.activeTasks.get(taskId)
      if (active) {
        active.stopLogStream = handle.stop
      }
    } catch (error) {
      this.logger
        .withMetadata({ taskId })
        .withError(error)
        .warn("Failed to stream container logs")
    }
  }

  private buildToolRegistry(taskId: string): {
    toolDefinitions: ToolDefinition[]
    toolHandlers: Record<string, ToolHandler>
  } {
    const toolDefinitions: ToolDefinition[] = [
      {
        name: "create_pr",
        description:
          "Request the orchestrator to create or record a pull request",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string" },
            title: { type: "string" },
            body: { type: "string" },
            draft: { type: "boolean" },
            head: { type: "string" },
            base: { type: "string" },
            repository: { type: "string" },
            head_branch: { type: "string" },
            base_branch: { type: "string" },
          },
        },
      },
    ]

    const toolHandlers: Record<string, ToolHandler> = {
      create_pr: async (request) =>
        this.handlePullRequestRequest(taskId, request.arguments ?? {}),
    }

    if (this.options.larkClient) {
      toolDefinitions.push(
        {
          name: "lark.post_comment",
          description: "Post a comment to a Lark doc",
          inputSchema: {
            type: "object",
            properties: {
              docToken: { type: "string" },
              commentId: { type: "string" },
              content: { type: "string" },
            },
          },
        },
        {
          name: "lark.post_card",
          description: "Post a Lark message card",
          inputSchema: {
            type: "object",
            properties: {
              payload: { type: "object" },
              url: { type: "string" },
              receive_id: { type: "string" },
              receive_id_type: { type: "string" },
            },
          },
        },
      )

      toolHandlers["lark.post_comment"] = async (request) =>
        await this.handleLarkCommentTool(taskId, request.arguments ?? {})
      toolHandlers["lark.post_card"] = async (request) =>
        await this.handleLarkCardTool(request.arguments ?? {})
    }

    return { toolDefinitions, toolHandlers }
  }

  private async handlePullRequestRequest(
    taskId: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const url = typeof args.url === "string" ? args.url : undefined
    const title = typeof args.title === "string" ? args.title : undefined
    const body = typeof args.body === "string" ? args.body : undefined
    const draft = typeof args.draft === "boolean" ? args.draft : undefined
    const base = typeof args.base === "string" ? args.base : undefined
    const head = typeof args.head === "string" ? args.head : undefined
    const repository =
      typeof args.repository === "string" ? args.repository : undefined
    const headBranch =
      typeof args.head_branch === "string" ? args.head_branch : undefined
    const baseBranch =
      typeof args.base_branch === "string" ? args.base_branch : undefined

    const record = await this.requireTask(taskId)
    const now = new Date().toISOString()
    const baseBranchValue = base ?? baseBranch ?? record.data?.githubBaseBranch
    const fallbackBase = this.options.githubClient?.defaultBaseBranch
    const resolvedBase = baseBranchValue ?? fallbackBase
    await this.updateTask(taskId, (data) => ({
      ...data,
      githubRepository: repository ?? data.githubRepository,
      githubHeadBranch: head ?? headBranch ?? data.githubHeadBranch,
      githubBaseBranch: resolvedBase ?? data.githubBaseBranch,
      pr: {
        url,
        requestedAt: now,
        status: "requested",
      },
    }))

    let prUrl = url
    if (!prUrl && this.options.githubClient) {
      const headRef =
        head ??
        headBranch ??
        record.data?.branchName ??
        record.data?.githubHeadBranch
      const baseRef = resolvedBase
      if (headRef && baseRef) {
        try {
          const request = {
            title: title ?? `AutoCoder: ${taskId}`,
            body,
            head: headRef,
            base: baseRef,
            ...(repository ? { repository } : {}),
            ...(draft !== undefined ? { draft } : {}),
          }
          const created =
            await this.options.githubClient.createPullRequest(request)
          prUrl = created.url
          await this.updateTask(taskId, (data) => ({
            ...data,
            pr: {
              url: created.url,
              requestedAt: now,
              status: "created",
            },
          }))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          await this.updateTask(taskId, (data) => ({
            ...data,
            pr: {
              url: prUrl,
              requestedAt: now,
              status: "failed",
              error: message,
            },
          }))
        }
      }
    }

    await this.transitionIfAllowed(taskId, "Reviewing")
    await this.sendWorkflowCard(
      taskId,
      "Reviewing",
      undefined,
      prUrl,
      this.activeTasks.get(taskId)?.latestTelemetry,
    )
    await this.shutdownTask(taskId)
    return { ok: true, url: prUrl, title }
  }

  private async handleLarkCommentTool(
    taskId: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const larkClient = this.options.larkClient
    if (!larkClient) {
      throw new Error("Lark is not configured")
    }

    const record = await this.requireTask(taskId)
    const docToken =
      typeof args.docToken === "string" ? args.docToken : record.data?.docToken
    if (!docToken) {
      throw new Error("docToken is required for lark.post_comment")
    }

    const content = typeof args.content === "string" ? args.content : undefined
    if (!content) {
      throw new Error("content is required for lark.post_comment")
    }

    const commentId =
      typeof args.commentId === "string" ? args.commentId : undefined
    await larkClient.postDocComment({
      docToken,
      payload: buildCommentPayload(content, commentId),
    })

    return { ok: true }
  }

  private async handleLarkCardTool(
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const larkClient = this.options.larkClient
    if (!larkClient) {
      throw new Error("Lark is not configured")
    }

    const card = isRecord(args.payload)
      ? args.payload
      : buildWorkflowCard({
          taskId: "unknown",
          state: "Planning",
        })
    const url = typeof args.url === "string" ? args.url : undefined

    const receiveId =
      typeof args.receive_id === "string" ? args.receive_id : undefined
    const receiveIdType =
      typeof args.receive_id_type === "string"
        ? args.receive_id_type
        : undefined

    await larkClient.postMessageCard({ card, url, receiveId, receiveIdType })
    return { ok: true }
  }

  private async runSoloLoop(
    taskId: string,
    active: ActiveTask,
    initialPrompt: string,
  ): Promise<void> {
    let prompt = initialPrompt
    for (let turn = 0; turn < MAX_SOLO_TURNS; turn += 1) {
      const { stopReason } = await this.runPrompt(taskId, active, prompt)
      if (stopReason === "end_turn") {
        await this.appendLog(taskId, {
          at: new Date().toISOString(),
          type: "system",
          message: "Agent completed turn",
        })
        const record = await this.requireTask(taskId)
        if (!record.data?.pr) {
          await this.handlePullRequestRequest(taskId, {})
        } else if (record.data.pr.url) {
          await this.sendWorkflowCard(
            taskId,
            "Reviewing",
            undefined,
            record.data.pr.url,
            this.activeTasks.get(taskId)?.latestTelemetry,
          )
        }
        break
      }

      if (stopReason === "refusal" || stopReason === "cancelled") {
        await this.appendLog(taskId, {
          at: new Date().toISOString(),
          type: "error",
          message: `Agent stopped with ${stopReason}`,
        })
        break
      }

      prompt = "continue"
    }
  }

  private async runPrompt(
    taskId: string,
    active: ActiveTask,
    prompt: string,
  ): Promise<{ stopReason: acp.StopReason; responseText: string }> {
    const collector: PromptCollector = { chunks: [] }
    active.pendingPrompt = collector

    try {
      const response = await active.acpClient.sendPrompt({
        sessionId: active.sessionId,
        prompt: [
          {
            type: "text",
            text: prompt,
          },
        ],
      })

      return {
        stopReason: response.stopReason,
        responseText: collector.chunks.join(""),
      }
    } finally {
      active.pendingPrompt = undefined
      await this.appendLog(taskId, {
        at: new Date().toISOString(),
        type: "system",
        message: "Prompt completed",
      })
    }
  }

  private async handleSessionUpdate(
    taskId: string,
    params: acp.SessionNotification,
  ): Promise<void> {
    const update = params.update
    const active = this.activeTasks.get(taskId)
    if (!active || params.sessionId !== active.sessionId) {
      return
    }

    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const text = extractChunkText(update)
        if (text) {
          active.pendingPrompt?.chunks.push(text)
          await this.updateTelemetry(taskId, active, {
            summary: `Assistant: ${truncate(text, 120)}`,
          })
        }
        await this.appendLog(
          taskId,
          buildLogEntry("agent_message", update, text),
        )
        break
      }
      case "agent_thought_chunk": {
        const text = extractChunkText(update)
        if (text) {
          await this.updateTelemetry(taskId, active, {
            summary: `Thought: ${truncate(text, 120)}`,
          })
        }
        await this.appendLog(
          taskId,
          buildLogEntry("agent_thought", update, text),
        )
        break
      }
      case "tool_call": {
        await this.updateTelemetry(taskId, active, {
          summary: `Tool: ${update.title ?? update.toolCallId}`,
        })
        await this.appendLog(taskId, buildToolLog("tool_call", update))
        break
      }
      case "tool_call_update": {
        if (update.status) {
          await this.updateTelemetry(taskId, active, {
            summary: `Tool ${update.status}: ${update.toolCallId}`,
          })
        }
        await this.appendLog(taskId, buildToolLog("tool_call_update", update))
        break
      }
      case "plan": {
        await this.appendLog(taskId, buildPlanLog(update))
        break
      }
      default:
        await this.appendLog(taskId, {
          at: new Date().toISOString(),
          type: "system",
          message: `Session update: ${update.sessionUpdate}`,
        })
    }
  }

  private async appendLog(
    taskId: string,
    entry: WorkflowLogEntry,
  ): Promise<void> {
    await this.updateTask(taskId, (data) => ({
      ...data,
      logs: [...(data.logs ?? []), entry],
    }))

    if (entry.type === "error") {
      const record = await this.store.get(taskId)
      if (record) {
        await this.sendWorkflowCard(
          taskId,
          record.state,
          record.data?.planContext,
          record.data?.pr?.url,
          this.activeTasks.get(taskId)?.latestTelemetry,
        )
      }
    }
  }

  private async sendWorkflowCard(
    taskId: string,
    state: WorkflowState,
    summary?: string,
    prUrl?: string,
    telemetry?: WorkflowTelemetry,
  ): Promise<void> {
    const larkClient = this.options.larkClient
    if (!larkClient) {
      return
    }

    const card = buildWorkflowCard({ taskId, state, summary, prUrl, telemetry })
    const record = await this.store.get(taskId)
    const variables: Record<string, string> = { TASK_ID: taskId }
    if (record?.data?.docToken) {
      variables.DOC_TOKEN = record.data.docToken
    }
    await larkClient.postMessageCard({
      card,
      variables,
      receiveId: record?.data?.messageCardReceiveId,
      receiveIdType: record?.data?.messageCardReceiveIdType,
    })
  }

  private async findTaskByBranch(
    branchName?: string,
  ): Promise<TaskRecord | null> {
    if (!branchName) {
      return null
    }

    const tasks = await this.store.list()
    return (
      tasks.find((record) => record.data?.branchName === branchName) ?? null
    )
  }

  private async updateTelemetry(
    taskId: string,
    active: ActiveTask,
    telemetry: WorkflowTelemetry,
  ): Promise<void> {
    const now = Date.now()
    active.latestTelemetry = telemetry
    if (
      active.lastTelemetryAt &&
      now - active.lastTelemetryAt < TELEMETRY_THROTTLE_MS
    ) {
      return
    }
    active.lastTelemetryAt = now
    const record = await this.store.get(taskId)
    if (!record) {
      return
    }
    await this.sendWorkflowCard(
      taskId,
      record.state,
      record.data?.planContext,
      record.data?.pr?.url,
      telemetry,
    )
  }

  async getToolRegistry(taskId: string): Promise<{
    toolDefinitions: ToolDefinition[]
    toolHandlers: Record<string, ToolHandler>
  }> {
    await this.requireTask(taskId)
    return this.buildToolRegistry(taskId)
  }
}

function buildCommentPrompt(
  planContext: string | undefined,
  comment: string,
): string {
  if (planContext) {
    return `Plan context:\n${planContext}\n\nComment:\n${comment}`
  }
  return `Comment:\n${comment}`
}

function buildReviewPrompt(
  comment: string,
  event: Extract<
    GithubWebhookEvent,
    {
      type:
        | "pull_request_review"
        | "pull_request_review_comment"
        | "issue_comment"
    }
  >,
): string {
  const location = event.pullRequestUrl ? `PR: ${event.pullRequestUrl}\n` : ""
  return `${location}Review feedback:\n${comment}`
}

function extractChunkText(update: acp.ContentChunk): string | undefined {
  if (update.content.type !== "text") {
    return undefined
  }
  return update.content.text
}

function buildLogEntry(
  type: WorkflowLogEntry["type"],
  update: acp.ContentChunk,
  text?: string,
): WorkflowLogEntry {
  return {
    at: new Date().toISOString(),
    type,
    message: text,
    data: {
      contentType: update.content.type,
    },
  }
}

function buildToolLog(
  type: "tool_call" | "tool_call_update",
  update: acp.ToolCall | acp.ToolCallUpdate,
): WorkflowLogEntry {
  return {
    at: new Date().toISOString(),
    type,
    message: update.title ?? undefined,
    data: {
      toolCallId: update.toolCallId,
      status: update.status ?? "unknown",
      kind: update.kind ?? "unknown",
    },
  }
}

function buildPlanLog(update: acp.Plan): WorkflowLogEntry {
  return {
    at: new Date().toISOString(),
    type: "plan",
    data: {
      entries: update.entries,
    },
  }
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }
  return `${text.slice(0, maxLength - 1)}…`
}

function buildCommentPayload(
  content: string,
  commentId?: string,
): Record<string, unknown> {
  const reply = {
    content: {
      elements: [
        {
          type: "text_run",
          text_run: { text: content },
        },
      ],
    },
  }

  if (commentId) {
    return {
      comment_id: commentId,
      reply_list: { replies: [reply] },
    }
  }

  return { reply_list: { replies: [reply] } }
}

function buildMcpServers(
  taskId: string,
  tools: ToolDefinition[],
  baseUrl?: string,
): Array<{
  type: "http"
  name: string
  url: string
  headers: Array<{ name: string; value: string }>
}> {
  if (!baseUrl || tools.length === 0) {
    return []
  }

  const url = `${baseUrl.replace(/\/$/, "")}/mcp/${taskId}`
  return [
    {
      type: "http",
      name: "autocoder-bot",
      url,
      headers: [],
    },
  ]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
