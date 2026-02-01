import type * as acp from "@agentclientprotocol/sdk"
import type { ProcessManager } from "../agent/processManager.js"
import type { AgentClient } from "../agent/types.js"
import type { AppConfig } from "../config/schema.js"
import type { LarkClient } from "../lark/client.js"
import type { DocService } from "../lark/docService.js"
import type { CardAction, ParsedMessage } from "../lark/types.js"
import type { SessionService } from "../session/service.js"
import type { Session } from "../session/types.js"
import type { Logger } from "../utils/logger.js"
import { createAcpClient } from "../agent/acpClient.js"
import { CommandHandler } from "../command/handler.js"
import { parseCommand } from "../command/parser.js"
import {
  buildErrorPost,
  buildModelSelectCard,
  buildPermissionCard,
  buildResultPost,
  buildSelectedCard,
  buildSessionDeleteCard,
  buildSessionListCard,
  buildWorkingPost,
} from "../lark/cardTemplates.js"
import { createDocTools } from "../lark/docTools.js"
import { extractErrorMessage } from "../utils/errors.js"

const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000

type PermissionResolver = {
  resolve: (resp: acp.RequestPermissionResponse) => void
  cardMessageId: string
  timer: ReturnType<typeof setTimeout>
}

type ActiveSession = {
  sessionId: string
  client: AgentClient
  acpSessionId: string
  availableCommands: string[]
  currentMode: string
  messageChunks: string[]
  permissionResolver?: PermissionResolver
}

export class Orchestrator {
  private activeSessions = new Map<string, ActiveSession>()
  private commandHandler: CommandHandler

  constructor(
    private config: AppConfig,
    private sessionService: SessionService,
    private processManager: ProcessManager,
    private larkClient: LarkClient,
    private docService: DocService,
    private logger: Logger,
  ) {
    this.commandHandler = new CommandHandler(
      this,
      sessionService,
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

    // Resolve or create session
    const session = await this.resolveSession(message)

    if (session) {
      if (session.status === "running") {
        await this.larkClient.replyText(
          message.messageId,
          "Agent is currently working. Please wait.",
        )
        return
      }

      // Session is idle — run in it
      await this.runInSession(session.id, message.text, message.messageId)
    } else {
      // No session found — create a new one
      await this.handleNewSession(message, message.messageId)
    }
  }

  async handleCardAction(action: CardAction): Promise<void> {
    switch (action.action) {
      case "permission_select":
        if (action.sessionId && action.optionId) {
          await this.handlePermissionSelect(
            action.sessionId,
            action.optionId,
            action.openMessageId,
          )
        }
        break

      case "session_select":
        if (action.sessionId) {
          await this.handleSessionSelect(
            action.sessionId,
            action.openMessageId,
            action.openChatId,
          )
        }
        break

      case "model_select":
        if (action.sessionId && action.modelId) {
          await this.handleModelSelectAction(
            action.sessionId,
            action.modelId,
            action.openMessageId,
          )
        }
        break

      case "session_delete":
        if (action.sessionId) {
          await this.handleSessionDeleteAction(
            action.sessionId,
            action.openMessageId,
          )
        }
        break

      default:
        this.logger.warn(`Unknown card action: ${action.action}`)
    }
  }

  async resolveSession(message: ParsedMessage): Promise<Session | null> {
    if (message.chatType === "p2p") {
      // p2p: find most recent session for this chat
      return this.sessionService.findSessionForChat(message.chatId)
    }

    // Group chat
    if (message.rootId) {
      // Inside a thread — find session by threadId (rootId)
      return this.sessionService.findSessionForThread(message.rootId)
    }

    // Top-level group message — no existing session
    return null
  }

  async handleNewSession(
    message: ParsedMessage,
    replyToMessageId: string,
  ): Promise<void> {
    const threadId =
      message.chatType === "p2p"
        ? message.chatId
        : (message.rootId ?? message.messageId)

    const session = await this.sessionService.createSession({
      chatId: message.chatId,
      threadId,
      creatorId: message.senderId,
      initialPrompt: message.text,
      workingDir: this.config.agent.workingDir,
      docToken: this.config.lark.docToken,
    })

    this.logger
      .withMetadata({
        sessionId: session.id,
        chatId: session.chatId,
        threadId,
        senderId: message.senderId,
        prompt: session.initialPrompt,
      })
      .info("New session created")

    if (message.text) {
      await this.runInSession(session.id, message.text, replyToMessageId)
    }
  }

  async handleListSessions(message: ParsedMessage): Promise<void> {
    const sessions = await this.sessionService.listSessions(message.chatId, 10)
    if (sessions.length === 0) {
      await this.larkClient.replyText(
        message.messageId,
        "No sessions found in this chat.",
      )
      return
    }

    const card = buildSessionListCard({ sessions })
    await this.larkClient.replyCard(message.messageId, card)
  }

  async handleDeleteSessions(message: ParsedMessage): Promise<void> {
    const sessions = await this.sessionService.listSessions(message.chatId, 10)
    if (sessions.length === 0) {
      await this.larkClient.replyText(
        message.messageId,
        "No sessions found in this chat.",
      )
      return
    }

    const card = buildSessionDeleteCard({ sessions })
    await this.larkClient.replyCard(message.messageId, card)
  }

  async handleModelSelect(
    sessionId: string,
    message: ParsedMessage,
  ): Promise<void> {
    const models = [
      { modelId: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
      {
        modelId: "claude-opus-4-20250514",
        label: "Claude Opus 4",
      },
      { modelId: "claude-haiku-3-5-20241022", label: "Claude Haiku 3.5" },
    ]
    const card = buildModelSelectCard({ sessionId, models })
    await this.larkClient.replyCard(message.messageId, card)
  }

  async runInSession(
    sessionId: string,
    prompt: string,
    replyToMessageId: string,
  ): Promise<void> {
    const session = await this.sessionService.getSession(sessionId)

    try {
      // Ensure agent session exists
      await this.ensureAgentSession(session)

      // Set running
      await this.sessionService.setRunning(sessionId)

      // Send "working..." placeholder as post (so we can edit it later)
      const planPrefix = session.isPlanMode ? "Plan mode | " : ""
      const workingMsgId = await this.larkClient.replyPost(
        replyToMessageId,
        buildWorkingPost(`${planPrefix}Processing...`),
      )
      if (workingMsgId) {
        await this.sessionService.setWorkingMessageId(sessionId, workingMsgId)
      }

      // Clear message chunks
      const active = this.activeSessions.get(sessionId)
      if (active) {
        active.messageChunks = []
      }

      // Send prompt
      this.logger
        .withMetadata({ sessionId, promptLength: prompt.length })
        .debug("Sending prompt to agent")

      const response = await active!.client.prompt({
        sessionId: active!.acpSessionId,
        prompt: [{ type: "text", text: prompt }],
      })

      this.logger
        .withMetadata({ sessionId, stopReason: response.stopReason })
        .info("Prompt completed")

      // Update working message to result
      const resultText = active!.messageChunks.join("")
      await this.finalizeWorkingMessage(
        sessionId,
        buildResultPost(resultText),
        replyToMessageId,
      )

      // Set idle
      await this.sessionService.setIdle(sessionId)
    } catch (error: unknown) {
      const msg = extractErrorMessage(error)
      this.logger
        .withError(error as Error)
        .error(`Prompt failed for session ${sessionId}`)

      // Update working message to error
      await this.finalizeWorkingMessage(
        sessionId,
        buildErrorPost(msg),
        replyToMessageId,
      )

      // Set idle
      try {
        await this.sessionService.setIdle(sessionId)
      } catch {
        // Session might already be idle
      }
    }
  }

  async stopSession(sessionId: string): Promise<void> {
    const active = this.activeSessions.get(sessionId)
    if (active) {
      try {
        await active.client.cancel({ sessionId: active.acpSessionId })
      } catch {
        // Ignore cancel errors
      }
    }
    this.processManager.kill(sessionId)
    this.cleanupSession(sessionId)

    await this.updateWorkingMessage(sessionId, buildWorkingPost("Stopped."))
    await this.sessionService.setWorkingMessageId(sessionId, null)

    try {
      await this.sessionService.setIdle(sessionId)
    } catch {
      // Already idle
    }
  }

  getActiveSession(
    sessionId: string,
  ): { client: AgentClient; acpSessionId: string } | undefined {
    const session = this.activeSessions.get(sessionId)
    if (!session) {
      return undefined
    }
    return { client: session.client, acpSessionId: session.acpSessionId }
  }

  getAvailableCommands(sessionId: string): string[] {
    return this.activeSessions.get(sessionId)?.availableCommands ?? []
  }

  private async ensureAgentSession(session: Session): Promise<void> {
    const existing = this.activeSessions.get(session.id)
    if (existing) {
      return
    }

    // Spawn process if needed
    if (!this.processManager.isAlive(session.id)) {
      this.processManager.spawn(session.id, session.workingDir)
    }

    const child = this.processManager.getProcess(session.id)
    if (!child) {
      throw new Error(`No process for session ${session.id}`)
    }

    // Build doc context
    const docContext = await this.docService.buildDocContext(session.docToken)
    const systemPrompt = [this.config.agent.systemPrompt, docContext]
      .filter(Boolean)
      .join("\n")

    // Create ACP client
    const acpClient = createAcpClient({
      process: child,
      logger: this.logger,
      onSessionUpdate: (params) => this.handleSessionUpdate(session.id, params),
      onPermissionRequest: (params) =>
        this.handlePermissionRequest(session.id, params),
      tools: createDocTools(this.larkClient),
    })

    this.logger
      .withMetadata({ sessionId: session.id })
      .debug("Initializing ACP connection")
    await acpClient.initialize()

    let acpSessionId: string

    if (session.acpSessionId) {
      // Resume existing ACP session
      this.logger
        .withMetadata({ sessionId: session.id })
        .debug("Resuming ACP session")
      await acpClient.resumeSession({
        sessionId: session.acpSessionId,
        cwd: session.workingDir,
      })
      acpSessionId = session.acpSessionId
    } else {
      // Create new ACP session
      this.logger
        .withMetadata({ sessionId: session.id })
        .debug("Creating new ACP session")
      const sessionResponse = await acpClient.newSession({
        cwd: session.workingDir,
        mcpServers: [],
        _meta: systemPrompt ? { systemPrompt } : undefined,
      })
      acpSessionId = sessionResponse.sessionId
      await this.sessionService.setAcpSessionId(session.id, acpSessionId)
    }

    this.activeSessions.set(session.id, {
      sessionId: session.id,
      client: acpClient,
      acpSessionId,
      availableCommands: [],
      currentMode: "",
      messageChunks: [],
    })
  }

  private async handlePermissionRequest(
    sessionId: string,
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    // Update working message to waiting state
    await this.updateWorkingMessage(
      sessionId,
      buildWorkingPost("Waiting for permission..."),
    )

    const session = await this.sessionService.getSession(sessionId)

    // Build and send permission card
    const options = params.options.map((opt) => ({
      optionId: opt.optionId,
      label: opt.name ?? opt.optionId,
    }))

    const card = buildPermissionCard({
      sessionId,
      toolDescription: params.toolCall?.title ?? "Permission required",
      options,
    })

    const cardMsgId = await this.larkClient.sendCard(session.chatId, card)

    // Wait for user selection with timeout
    return new Promise<acp.RequestPermissionResponse>((resolve) => {
      const timer = setTimeout(() => {
        // Timeout — cancel
        const active = this.activeSessions.get(sessionId)
        if (active?.permissionResolver) {
          active.permissionResolver = undefined
        }
        resolve({ outcome: { outcome: "cancelled" } })
      }, PERMISSION_TIMEOUT_MS)

      const active = this.activeSessions.get(sessionId)
      if (active) {
        active.permissionResolver = {
          resolve,
          cardMessageId: cardMsgId ?? "",
          timer,
        }
      } else {
        clearTimeout(timer)
        resolve({ outcome: { outcome: "cancelled" } })
      }
    })
  }

  private async handlePermissionSelect(
    sessionId: string,
    optionId: string,
    cardMessageId: string,
  ): Promise<void> {
    const active = this.activeSessions.get(sessionId)
    if (!active?.permissionResolver) {
      return
    }

    const { resolve, timer } = active.permissionResolver
    clearTimeout(timer)
    active.permissionResolver = undefined

    // Update card to show selection
    await this.larkClient.updateCard(
      cardMessageId,
      buildSelectedCard(`Selected: ${optionId}`),
    )

    // Update working message back to processing
    const session = await this.sessionService.getSession(sessionId)
    const planPrefix = session.isPlanMode ? "Plan mode | " : ""
    await this.updateWorkingMessage(
      sessionId,
      buildWorkingPost(`${planPrefix}Processing...`),
    )

    // Resolve the permission promise
    resolve({
      outcome: { outcome: "selected", optionId },
    })
  }

  private async handleSessionSelect(
    sessionId: string,
    cardMessageId: string,
    chatId: string,
  ): Promise<void> {
    try {
      const session = await this.sessionService.getSession(sessionId)
      const label = session.initialPrompt.slice(0, 50)

      // Update card to show selection
      await this.larkClient.updateCard(
        cardMessageId,
        buildSelectedCard(`Resumed session: ${label}`),
      )

      await this.larkClient.sendText(chatId, `Switched to session: ${label}`)
    } catch {
      await this.larkClient.updateCard(
        cardMessageId,
        buildSelectedCard("Session not found"),
      )
    }
  }

  private async handleModelSelectAction(
    sessionId: string,
    modelId: string,
    cardMessageId: string,
  ): Promise<void> {
    const active = this.activeSessions.get(sessionId)
    if (active) {
      try {
        await active.client.setSessionModel({
          sessionId: active.acpSessionId,
          modelId,
        })
      } catch (error: unknown) {
        this.logger
          .withError(error as Error)
          .error("Failed to set session model")
      }
    }

    await this.larkClient.updateCard(
      cardMessageId,
      buildSelectedCard(`Model: ${modelId}`),
    )
  }

  private async handleSessionDeleteAction(
    sessionId: string,
    cardMessageId: string,
  ): Promise<void> {
    try {
      const session = await this.sessionService.getSession(sessionId)
      const label = session.initialPrompt.slice(0, 50)

      // Stop the session if running
      if (session.status === "running") {
        await this.stopSession(sessionId)
      } else {
        // Clean up active session resources if any
        this.cleanupSession(sessionId)
        this.processManager.kill(sessionId)
      }

      // Delete from DB
      await this.sessionService.deleteSession(sessionId)

      await this.larkClient.updateCard(
        cardMessageId,
        buildSelectedCard(`Deleted session: ${label}`),
      )
    } catch {
      await this.larkClient.updateCard(
        cardMessageId,
        buildSelectedCard("Session not found"),
      )
    }
  }

  private async handleSessionUpdate(
    sessionId: string,
    params: acp.SessionNotification,
  ): Promise<void> {
    const update = params.update
    if (!update) {
      return
    }

    const updateType = (update as Record<string, unknown>).sessionUpdate as
      | string
      | undefined

    this.logger
      .withMetadata({ sessionId, updateType })
      .trace("Session update received")

    const active = this.activeSessions.get(sessionId)
    if (!active) {
      return
    }

    switch (updateType) {
      case "agent_message_chunk": {
        const content = (update as Record<string, unknown>).content as
          | Record<string, unknown>
          | undefined
        const text = content?.text as string | undefined
        if (text) {
          active.messageChunks.push(text)
        }
        break
      }
      case "current_mode_update": {
        const modeId = (update as Record<string, unknown>).currentModeId as
          | string
          | undefined
        if (modeId) {
          active.currentMode = modeId
        }
        break
      }
      case "available_commands_update": {
        const commands = (update as Record<string, unknown>)
          .availableCommands as Array<{ name: string }> | undefined
        active.availableCommands = commands?.map((c) => c.name) ?? []
        break
      }
      case "tool_call":
        this.logger
          .withMetadata({
            sessionId,
            tool: (update as Record<string, unknown>).title,
          })
          .debug("Agent tool call")
        break
      default:
        break
    }
  }

  private async updateWorkingMessage(
    sessionId: string,
    post: Record<string, unknown>,
  ): Promise<void> {
    try {
      const session = await this.sessionService.getSession(sessionId)
      if (session.workingMessageId) {
        await this.larkClient.editMessage(
          session.workingMessageId,
          "post",
          JSON.stringify(post),
        )
      }
    } catch {
      // Ignore update failures
    }
  }

  private async finalizeWorkingMessage(
    sessionId: string,
    post: Record<string, unknown>,
    fallbackReplyMessageId: string,
  ): Promise<void> {
    const session = await this.sessionService.getSession(sessionId)
    if (session.workingMessageId) {
      await this.larkClient.editMessage(
        session.workingMessageId,
        "post",
        JSON.stringify(post),
      )
      await this.sessionService.setWorkingMessageId(sessionId, null)
    } else {
      await this.larkClient.replyPost(fallbackReplyMessageId, post)
    }
  }

  private cleanupSession(sessionId: string): void {
    const active = this.activeSessions.get(sessionId)
    if (active?.permissionResolver) {
      clearTimeout(active.permissionResolver.timer)
    }
    this.activeSessions.delete(sessionId)
  }

  shutdown(): void {
    this.processManager.killAll()
    for (const active of this.activeSessions.values()) {
      if (active.permissionResolver) {
        clearTimeout(active.permissionResolver.timer)
      }
    }
    this.activeSessions.clear()
  }
}
