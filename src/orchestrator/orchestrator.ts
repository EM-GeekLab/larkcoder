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
import { throttle } from "radashi"
import { extractErrorMessage } from "../utils/errors.js"
import { ThreadMapper } from "./threadMapper.js"

type ActiveSession = {
  taskId: string
  client: AgentClient
  sessionId: string
  throttledCardUpdate: ReturnType<typeof throttle>
  availableCommands: string[]
}

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
      this.logger
        .withMetadata({ taskId: task.id })
        .debug("Agent process spawned")

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
      this.logger
        .withMetadata({ taskId: task.id })
        .debug("Initializing ACP connection")
      await acpClient.initialize()
      this.logger
        .withMetadata({ taskId: task.id })
        .debug("ACP connection initialized, creating session")
      const sessionResponse = await acpClient.newSession({
        cwd: task.workingDir,
        mcpServers: [],
        _meta: systemPrompt ? { systemPrompt } : undefined,
      })

      const sessionId = sessionResponse.sessionId
      await this.taskService.setSessionId(task.id, sessionId)
      this.logger
        .withMetadata({ taskId: task.id, sessionId })
        .debug("ACP session created")

      this.activeSessions.set(task.id, {
        taskId: task.id,
        client: acpClient,
        sessionId,
        throttledCardUpdate: throttle(
          { interval: 10_000, trailing: true },
          (activity: string) => {
            void this.doCardUpdate(task.id, activity)
          },
        ),
        availableCommands: [],
      })

      // Send the initial prompt
      this.logger
        .withMetadata({ taskId: task.id })
        .debug("Sending initial prompt to agent")
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

    this.logger
      .withMetadata({ taskId, promptLength: prompt.length })
      .debug("Sending prompt to agent")

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
        throttledCardUpdate: throttle(
          { interval: 10_000, trailing: true },
          (activity: string) => {
            void this.doCardUpdate(taskId, activity)
          },
        ),
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
      this.logger
        .withMetadata({ taskId })
        .debug("Received empty session update")
      return
    }

    let activity: string | undefined

    const updateType = (update as Record<string, unknown>).sessionUpdate as
      | string
      | undefined

    this.logger
      .withMetadata({ taskId, updateType })
      .trace("Session update received")

    switch (updateType) {
      case "agent_message_chunk":
        activity = `Assistant: ${((update as Record<string, unknown>).text as string | undefined)?.slice(0, 80) ?? ""}`
        break
      case "agent_thought_chunk":
        activity = `Thinking: ${((update as Record<string, unknown>).text as string | undefined)?.slice(0, 80) ?? ""}`
        break
      case "tool_call":
        activity = `Tool: ${(update as Record<string, unknown>).title ?? "unknown"}`
        this.logger
          .withMetadata({
            taskId,
            tool: (update as Record<string, unknown>).title,
          })
          .debug("Agent tool call")
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
      default:
        this.logger
          .withMetadata({ taskId, updateType })
          .debug("Unknown session update type")
        break
    }

    if (activity) {
      this.throttledCardUpdate(taskId, activity)
    }
  }

  private throttledCardUpdate(taskId: string, activity: string): void {
    const session = this.activeSessions.get(taskId)
    if (!session) {
      this.logger
        .withMetadata({ taskId })
        .debug("Throttled card update skipped: no session")
      return
    }
    session.throttledCardUpdate(activity)
  }

  private async doCardUpdate(taskId: string, activity: string): Promise<void> {
    const task = await this.taskService.getTask(taskId)
    const card = buildStatusCard({
      taskId: task.id,
      status: task.status,
      prompt: task.prompt,
      summary: task.summary,
      lastActivity: activity,
    })

    if (task.cardMessageId) {
      this.logger
        .withMetadata({ taskId, cardMessageId: task.cardMessageId, activity })
        .debug("Updating status card (throttled)")
      await this.larkClient.updateCard(task.cardMessageId, card)
    } else {
      this.logger
        .withMetadata({ taskId })
        .debug("Skipped card update: no cardMessageId")
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

    this.logger
      .withMetadata({ taskId: task.id, replyToMessageId })
      .debug("Sending initial status card")
    const messageId = await this.larkClient.replyCard(replyToMessageId, card)
    if (messageId) {
      this.logger
        .withMetadata({ taskId: task.id, cardMessageId: messageId })
        .debug("Status card sent")
      await this.taskService.setCardMessageId(task.id, messageId)
    } else {
      this.logger
        .withMetadata({ taskId: task.id })
        .warn("Failed to get cardMessageId from replyCard")
    }
  }

  private async updateStatusCard(task: Task): Promise<void> {
    if (!task.cardMessageId) {
      this.logger
        .withMetadata({ taskId: task.id })
        .debug("Skipped final card update: no cardMessageId")
      return
    }

    this.logger
      .withMetadata({
        taskId: task.id,
        status: task.status,
        cardMessageId: task.cardMessageId,
      })
      .debug("Updating final status card")

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
