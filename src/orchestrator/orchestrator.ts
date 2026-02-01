import type * as acp from "@agentclientprotocol/sdk"
import type { ProcessManager } from "../agent/processManager.js"
import type { AgentClient } from "../agent/types.js"
import type { AppConfig } from "../config/schema.js"
import type { LarkClient } from "../lark/client.js"
import type { DocService } from "../lark/docService.js"
import type { CardAction, ParsedMessage } from "../lark/types.js"
import type { TaskService } from "../task/service.js"
import type { Task } from "../task/types.js"
import type { Logger } from "../utils/logger.js"
import { createAcpClient } from "../agent/acpClient.js"
import { CommandHandler } from "../command/handler.js"
import { parseCommand } from "../command/parser.js"
import { buildStatusCard } from "../lark/cardTemplates.js"
import { createDocTools } from "../lark/docTools.js"
import { extractErrorMessage } from "../utils/errors.js"
import { ThreadMapper } from "./threadMapper.js"

type ActiveSession = {
  taskId: string
  client: AgentClient
  sessionId: string
  lastCardUpdateAt: number
  availableCommands: string[]
}

const CARD_THROTTLE_MS = 3000

export class Orchestrator {
  private activeSessions = new Map<string, ActiveSession>()
  private threadMapper: ThreadMapper
  private commandHandler: CommandHandler

  constructor(
    private config: AppConfig,
    private taskService: TaskService,
    private processManager: ProcessManager,
    private larkClient: LarkClient,
    private docService: DocService,
    private logger: Logger,
  ) {
    this.threadMapper = new ThreadMapper(taskService)
    this.commandHandler = new CommandHandler(
      this,
      taskService,
      larkClient,
      logger,
    )
  }

  async handleMessage(message: ParsedMessage): Promise<void> {
    const threadId = message.rootId ?? message.messageId

    // Check for slash command
    const parsed = parseCommand(message.text)
    if (parsed) {
      await this.commandHandler.handle(parsed, message, threadId)
      return
    }

    // Check for existing active task in this thread
    const existingTask =
      await this.threadMapper.findActiveTaskForThread(threadId)

    if (existingTask) {
      await this.handleFollowUp(existingTask, message)
    } else {
      await this.handleNewTask(message, threadId)
    }
  }

  async handleCardAction(action: CardAction): Promise<void> {
    if (!action.taskId) {
      return
    }

    switch (action.action) {
      case "stop":
        await this.stopTask(action.taskId)
        break
      case "continue":
        await this.continueTask(action.taskId, "continue")
        break
      case "complete":
        await this.markComplete(action.taskId)
        break
      case "retry":
        await this.retryTask(action.taskId)
        break
      default:
        this.logger.warn(`Unknown card action: ${action.action}`)
    }
  }

  async handleNewTask(message: ParsedMessage, threadId: string): Promise<void> {
    const task = await this.taskService.createTask({
      chatId: message.chatId,
      threadId,
      creatorId: message.senderId,
      prompt: message.text,
      workingDir: this.config.agent.workingDir,
      docToken: this.config.lark.docToken,
    })

    this.logger
      .withMetadata({
        taskId: task.id,
        chatId: task.chatId,
        threadId,
        senderId: message.senderId,
        prompt: task.prompt,
      })
      .info("New task created")

    // Send initial status card
    await this.sendStatusCard(task, message.messageId)

    // Start the agent
    await this.startAgent(task)
  }

  private async handleFollowUp(
    task: Task,
    message: ParsedMessage,
  ): Promise<void> {
    this.logger
      .withMetadata({
        taskId: task.id,
        taskStatus: task.status,
        senderId: message.senderId,
        text: message.text,
      })
      .info("Follow-up message for existing task")

    switch (task.status) {
      case "waiting":
        // Resume the agent with user's feedback
        await this.continueTask(task.id, message.text)
        break

      case "running": {
        // Agent is busy, let user know
        await this.larkClient.replyText(
          message.messageId,
          "Agent is currently working. Please wait for it to finish.",
        )
        break
      }

      case "failed":
        // Retry with the new message
        await this.retryTask(task.id, message.text)
        break

      default:
        await this.larkClient.replyText(
          message.messageId,
          `Task is in ${task.status} state.`,
        )
    }
  }

  async startAgent(task: Task): Promise<void> {
    try {
      await this.taskService.startTask(task.id)

      // Spawn the ACP server process
      const processInfo = this.processManager.spawn(task.id, task.workingDir)

      // Build doc context if available
      const docContext = await this.docService.buildDocContext(task.docToken)
      const systemPrompt = [this.config.agent.systemPrompt, docContext]
        .filter(Boolean)
        .join("\n")

      // Create ACP client with stdio pipes
      const acpClient = createAcpClient({
        process: processInfo.process,
        logger: this.logger,
        onSessionUpdate: (params) => this.handleSessionUpdate(task.id, params),
        tools: createDocTools(this.larkClient),
      })

      // Initialize and create session
      await acpClient.initialize()
      const sessionResponse = await acpClient.newSession({
        cwd: task.workingDir,
        mcpServers: [],
        _meta: systemPrompt ? { systemPrompt } : undefined,
      })

      const sessionId = sessionResponse.sessionId
      await this.taskService.setSessionId(task.id, sessionId)

      this.activeSessions.set(task.id, {
        taskId: task.id,
        client: acpClient,
        sessionId,
        lastCardUpdateAt: 0,
        availableCommands: [],
      })

      // Send the initial prompt
      await this.runPrompt(task.id, task.prompt)
    } catch (error: unknown) {
      const msg = extractErrorMessage(error)
      this.logger
        .withError(error as Error)
        .error(`Failed to start agent for task ${task.id}`)
      await this.taskService.failTask(task.id, msg)
      this.processManager.kill(task.id)

      const updated = await this.taskService.getTask(task.id)
      await this.updateStatusCard(updated)
    }
  }

  async runPrompt(taskId: string, prompt: string): Promise<void> {
    const session = this.activeSessions.get(taskId)
    if (!session) {
      this.logger.error(`No active session for task ${taskId}`)
      return
    }

    try {
      const response = await session.client.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: prompt }],
      })

      const stopReason = response.stopReason
      this.logger.withMetadata({ taskId, stopReason }).info("Prompt completed")

      if (stopReason === "end_turn") {
        // Agent finished, wait for user feedback
        await this.taskService.setWaiting(taskId)
      } else if (stopReason === "cancelled") {
        await this.taskService.cancelTask(taskId)
      } else {
        await this.taskService.setWaiting(taskId)
      }

      const updated = await this.taskService.getTask(taskId)
      await this.updateStatusCard(updated)
    } catch (error: unknown) {
      const msg = extractErrorMessage(error)
      this.logger
        .withError(error as Error)
        .error(`Prompt failed for task ${taskId}`)
      await this.taskService.failTask(taskId, msg)
      this.cleanupSession(taskId)

      const updated = await this.taskService.getTask(taskId)
      await this.updateStatusCard(updated)
    }
  }

  async continueTask(taskId: string, prompt: string): Promise<void> {
    const task = await this.taskService.getTask(taskId)

    let session = this.activeSessions.get(taskId)
    if (!session) {
      // Need to re-establish the session
      if (!task.sessionId) {
        this.logger.error(`No session ID for task ${taskId}, cannot resume`)
        return
      }

      // Re-spawn process if needed
      if (!this.processManager.isAlive(taskId)) {
        this.processManager.spawn(taskId, task.workingDir)
      }

      const child = this.processManager.getProcess(taskId)
      if (!child) {
        this.logger.error(`No process for task ${taskId}`)
        return
      }

      const acpClient = createAcpClient({
        process: child,
        logger: this.logger,
        onSessionUpdate: (params) => this.handleSessionUpdate(taskId, params),
        tools: createDocTools(this.larkClient),
      })

      await acpClient.initialize()
      await acpClient.resumeSession({
        sessionId: task.sessionId,
        cwd: task.workingDir,
      })

      session = {
        taskId,
        client: acpClient,
        sessionId: task.sessionId,
        lastCardUpdateAt: 0,
        availableCommands: [],
      }
      this.activeSessions.set(taskId, session)
    }

    await this.taskService.startTask(taskId)
    const updated = await this.taskService.getTask(taskId)
    await this.updateStatusCard(updated)

    await this.runPrompt(taskId, prompt)
  }

  async stopTask(taskId: string): Promise<void> {
    const session = this.activeSessions.get(taskId)
    if (session) {
      await session.client.cancel({ sessionId: session.sessionId })
    }
    this.processManager.kill(taskId)
    this.cleanupSession(taskId)

    await this.taskService.cancelTask(taskId)
    const updated = await this.taskService.getTask(taskId)
    await this.updateStatusCard(updated)
  }

  async markComplete(taskId: string): Promise<void> {
    this.processManager.kill(taskId)
    this.cleanupSession(taskId)

    await this.taskService.completeTask(taskId)
    const updated = await this.taskService.getTask(taskId)
    await this.updateStatusCard(updated)
  }

  async retryTask(taskId: string, newPrompt?: string): Promise<void> {
    this.processManager.kill(taskId)
    this.cleanupSession(taskId)

    const task = await this.taskService.getTask(taskId)
    await this.taskService.startTask(taskId)
    await this.startAgent({ ...task, prompt: newPrompt ?? task.prompt })
  }

  getActiveSession(
    taskId: string,
  ): { client: AgentClient; sessionId: string } | undefined {
    const session = this.activeSessions.get(taskId)
    if (!session) {
      return undefined
    }
    return { client: session.client, sessionId: session.sessionId }
  }

  getAvailableCommands(taskId: string): string[] {
    return this.activeSessions.get(taskId)?.availableCommands ?? []
  }

  private async handleSessionUpdate(
    taskId: string,
    params: acp.SessionNotification,
  ): Promise<void> {
    const update = params.update
    if (!update) {
      return
    }

    let activity: string | undefined

    const updateType = (update as Record<string, unknown>).sessionUpdate as
      | string
      | undefined

    switch (updateType) {
      case "agent_message_chunk":
        activity = `Assistant: ${((update as Record<string, unknown>).text as string | undefined)?.slice(0, 80) ?? ""}`
        break
      case "agent_thought_chunk":
        activity = `Thinking: ${((update as Record<string, unknown>).text as string | undefined)?.slice(0, 80) ?? ""}`
        break
      case "tool_call":
        activity = `Tool: ${(update as Record<string, unknown>).title ?? "unknown"}`
        break
      case "available_commands_update": {
        const session = this.activeSessions.get(taskId)
        if (session) {
          const commands = (update as Record<string, unknown>).commands as
            | Array<{ name: string }>
            | undefined
          session.availableCommands = commands?.map((c) => c.name) ?? []
        }
        break
      }
    }

    if (activity) {
      await this.throttledCardUpdate(taskId, activity)
    }
  }

  private async throttledCardUpdate(
    taskId: string,
    activity: string,
  ): Promise<void> {
    const session = this.activeSessions.get(taskId)
    if (!session) {
      return
    }

    const now = Date.now()
    if (now - session.lastCardUpdateAt < CARD_THROTTLE_MS) {
      return
    }
    session.lastCardUpdateAt = now

    const task = await this.taskService.getTask(taskId)
    const card = buildStatusCard({
      taskId: task.id,
      status: task.status,
      prompt: task.prompt,
      summary: task.summary,
      lastActivity: activity,
    })

    if (task.cardMessageId) {
      await this.larkClient.updateCard(task.cardMessageId, card)
    }
  }

  private async sendStatusCard(
    task: Task,
    replyToMessageId: string,
  ): Promise<void> {
    const card = buildStatusCard({
      taskId: task.id,
      status: task.status,
      prompt: task.prompt,
    })

    const messageId = await this.larkClient.replyCard(replyToMessageId, card)
    if (messageId) {
      await this.taskService.setCardMessageId(task.id, messageId)
    }
  }

  private async updateStatusCard(task: Task): Promise<void> {
    if (!task.cardMessageId) {
      return
    }

    const card = buildStatusCard({
      taskId: task.id,
      status: task.status,
      prompt: task.prompt,
      summary: task.summary,
      errorMessage: task.errorMessage,
    })

    await this.larkClient.updateCard(task.cardMessageId, card)
  }

  private cleanupSession(taskId: string): void {
    this.activeSessions.delete(taskId)
  }

  shutdown(): void {
    this.processManager.killAll()
    this.activeSessions.clear()
  }
}
