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
  PROCESSING_ELEMENT_ID,
  STREAMING_ELEMENT_ID,
  buildModelSelectCard,
  buildPermissionCard,
  buildPermissionSelectedCard,
  buildSelectedCard,
  buildSessionDeleteCard,
  buildSessionListCard,
  buildStreamingCard,
  buildStreamingCloseSettings,
} from "../lark/cardTemplates.js"
import { createDocTools } from "../lark/docTools.js"
import { extractErrorMessage } from "../utils/errors.js"

const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000
const STREAM_FLUSH_INTERVAL_MS = 150
const STREAM_AUTO_CLOSE_MS = 10 * 60 * 1000
const STREAM_MAX_CONTENT_LENGTH = 100_000

type PermissionResolver = {
  resolve: (resp: acp.RequestPermissionResponse) => void
  cardMessageId: string
  timer: ReturnType<typeof setTimeout>
  toolDescription: string
  options: Array<{ optionId: string; label: string }>
}

type StreamingCard = {
  cardId: string
  messageId: string
  sequence: number
  accumulatedText: string
  lastFlushedText: string
  flushTimer: ReturnType<typeof setTimeout> | null
  streamingOpen: boolean
  streamingOpenedAt: number
  placeholderReplaced: boolean
}

type ActiveSession = {
  sessionId: string
  client: AgentClient
  acpSessionId: string
  availableCommands: string[]
  currentMode: string
  streamingCard?: StreamingCard
  permissionResolvers: Map<string, PermissionResolver>
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
    this.commandHandler = new CommandHandler(this, sessionService, larkClient, logger)
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
        await this.larkClient.replyMarkdownCard(
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
          await this.handlePermissionSelect(action.sessionId, action.optionId, action.openMessageId)
        }
        break

      case "session_select":
        if (action.sessionId) {
          await this.handleSessionSelect(action.sessionId, action.openMessageId, action.openChatId)
        }
        break

      case "model_select":
        if (action.sessionId && action.modelId) {
          await this.handleModelSelectAction(action.sessionId, action.modelId, action.openMessageId)
        }
        break

      case "session_delete":
        if (action.sessionId) {
          await this.handleSessionDeleteAction(action.sessionId, action.openMessageId)
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

  async handleNewSession(message: ParsedMessage, replyToMessageId: string): Promise<void> {
    const threadId =
      message.chatType === "p2p" ? message.chatId : (message.rootId ?? message.messageId)

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
      await this.larkClient.replyMarkdownCard(message.messageId, "No sessions found in this chat.")
      return
    }

    const card = buildSessionListCard({ sessions })
    await this.larkClient.replyCard(message.messageId, card)
  }

  async handleDeleteSessions(message: ParsedMessage): Promise<void> {
    const sessions = await this.sessionService.listSessions(message.chatId, 10)
    if (sessions.length === 0) {
      await this.larkClient.replyMarkdownCard(message.messageId, "No sessions found in this chat.")
      return
    }

    const card = buildSessionDeleteCard({ sessions })
    await this.larkClient.replyCard(message.messageId, card)
  }

  async handleModelSelect(sessionId: string, message: ParsedMessage): Promise<void> {
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

  async runInSession(sessionId: string, prompt: string, replyToMessageId: string): Promise<void> {
    const session = await this.sessionService.getSession(sessionId)

    try {
      // Ensure agent session exists
      await this.ensureAgentSession(session)

      // Set running
      await this.sessionService.setRunning(sessionId)

      // Create streaming card
      await this.createStreamingCard(sessionId, replyToMessageId, "")

      // Send prompt
      const active = this.activeSessions.get(sessionId)

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

      // Close streaming card with summary
      const summaryText = active!.streamingCard?.accumulatedText ?? ""
      const summary =
        summaryText.length > 100 ? `${summaryText.slice(0, 100)}...` : summaryText || "(no output)"
      await this.closeStreamingCard(sessionId, summary)

      // Set idle
      await this.sessionService.setIdle(sessionId)
    } catch (error: unknown) {
      const msg = extractErrorMessage(error)
      this.logger.withError(error as Error).error(`Prompt failed for session ${sessionId}`)

      // Append error to streaming card and close
      const active = this.activeSessions.get(sessionId)
      if (active?.streamingCard) {
        active.streamingCard.accumulatedText += `\n\n**Error:** ${msg}`
        await this.forceFlush(sessionId)
        await this.closeStreamingCard(sessionId, `Error: ${msg}`)
      } else {
        // No streaming card — fallback to markdown card
        await this.larkClient.replyMarkdownCard(replyToMessageId, `**Error:** ${msg}`)
      }

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
      // Close streaming card if open
      if (active.streamingCard) {
        active.streamingCard.accumulatedText += "\n\n*Stopped.*"
        await this.forceFlush(sessionId)
        await this.closeStreamingCard(sessionId, "Stopped.")
      }

      try {
        await active.client.cancel({ sessionId: active.acpSessionId })
      } catch {
        // Ignore cancel errors
      }
    }
    this.processManager.kill(sessionId)
    this.cleanupSession(sessionId)

    try {
      await this.sessionService.setIdle(sessionId)
    } catch {
      // Already idle
    }
  }

  getActiveSession(sessionId: string): { client: AgentClient; acpSessionId: string } | undefined {
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
    const systemPrompt = [this.config.agent.systemPrompt, docContext].filter(Boolean).join("\n")

    // Create ACP client
    const acpClient = createAcpClient({
      process: child,
      logger: this.logger,
      onSessionUpdate: (params) => this.handleSessionUpdate(session.id, params),
      onPermissionRequest: (params) => this.handlePermissionRequest(session.id, params),
      tools: createDocTools(this.larkClient),
    })

    this.logger.withMetadata({ sessionId: session.id }).debug("Initializing ACP connection")
    await acpClient.initialize()

    let acpSessionId: string

    if (session.acpSessionId) {
      // Resume existing ACP session
      this.logger.withMetadata({ sessionId: session.id }).debug("Resuming ACP session")
      await acpClient.resumeSession({
        sessionId: session.acpSessionId,
        cwd: session.workingDir,
      })
      acpSessionId = session.acpSessionId
    } else {
      // Create new ACP session
      this.logger.withMetadata({ sessionId: session.id }).debug("Creating new ACP session")
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
      permissionResolvers: new Map(),
    })
  }

  private async handlePermissionRequest(
    sessionId: string,
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    // Pause streaming and close current card before showing permission request
    await this.pauseStreamingForInteraction(sessionId, "(等待授权)")

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
    const resolverKey = cardMsgId ?? ""

    // Wait for user selection with timeout
    return new Promise<acp.RequestPermissionResponse>((resolve) => {
      const timer = setTimeout(() => {
        // Timeout — cancel
        const active = this.activeSessions.get(sessionId)
        active?.permissionResolvers.delete(resolverKey)
        resolve({ outcome: { outcome: "cancelled" } })
      }, PERMISSION_TIMEOUT_MS)

      const active = this.activeSessions.get(sessionId)
      if (active) {
        active.permissionResolvers.set(resolverKey, {
          resolve,
          cardMessageId: resolverKey,
          timer,
          toolDescription: params.toolCall?.title ?? "Permission required",
          options,
        })
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
    if (!active) {
      return
    }
    const resolver = active.permissionResolvers.get(cardMessageId)
    if (!resolver) {
      return
    }

    clearTimeout(resolver.timer)
    active.permissionResolvers.delete(cardMessageId)

    // Find the selected option label
    const selectedOption = resolver.options.find((opt) => opt.optionId === optionId)
    const selectedLabel = selectedOption?.label ?? optionId

    // Update card to show only the selected option, without buttons
    await this.larkClient.updateCard(
      cardMessageId,
      buildPermissionSelectedCard({
        toolDescription: resolver.toolDescription,
        selectedLabel,
      }),
    )

    // Resume streaming with a new card after permission is granted
    await this.resumeStreamingAfterInteraction(sessionId, cardMessageId, "")

    // Resolve the permission promise
    resolver.resolve({
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

      await this.larkClient.sendMarkdownCard(chatId, `Switched to session: ${label}`)
    } catch {
      await this.larkClient.updateCard(cardMessageId, buildSelectedCard("Session not found"))
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
        this.logger.withError(error as Error).error("Failed to set session model")
      }
    }

    await this.larkClient.updateCard(cardMessageId, buildSelectedCard(`Model: ${modelId}`))
  }

  private async handleSessionDeleteAction(sessionId: string, cardMessageId: string): Promise<void> {
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
      await this.larkClient.updateCard(cardMessageId, buildSelectedCard("Session not found"))
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

    const updateType = (update as Record<string, unknown>).sessionUpdate as string | undefined

    this.logger.withMetadata({ sessionId, updateType }).trace("Session update received")

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
        if (text && active.streamingCard) {
          active.streamingCard.accumulatedText += text
          this.scheduleFlush(sessionId)
        }
        break
      }
      case "current_mode_update": {
        const modeId = (update as Record<string, unknown>).currentModeId as string | undefined
        if (modeId) {
          active.currentMode = modeId
        }
        break
      }
      case "available_commands_update": {
        const commands = (update as Record<string, unknown>).availableCommands as
          | Array<{ name: string }>
          | undefined
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

  private async createStreamingCard(
    sessionId: string,
    replyToMessageId: string | undefined,
    initialContent: string,
  ): Promise<void> {
    const active = this.activeSessions.get(sessionId)
    if (!active) {
      return
    }

    const cardId = await this.larkClient.createCardEntity(buildStreamingCard(initialContent))
    if (!cardId) {
      this.logger.error("Failed to create streaming card entity")
      return
    }

    let messageId: string | undefined
    if (replyToMessageId) {
      // Reply to existing message
      messageId = await this.larkClient.replyCardEntity(replyToMessageId, cardId)
    } else {
      // Send as new independent message using existing sendCard method
      const session = await this.sessionService.getSession(sessionId)
      messageId = await this.larkClient.sendCard(session.chatId, {
        type: "card",
        data: { card_id: cardId },
      })
    }

    if (!messageId) {
      this.logger.error("Failed to send streaming card")
      return
    }

    await this.sessionService.setWorkingMessageId(sessionId, messageId)

    active.streamingCard = {
      cardId,
      messageId,
      sequence: 0,
      accumulatedText: initialContent,
      lastFlushedText: initialContent,
      flushTimer: null,
      streamingOpen: true,
      streamingOpenedAt: Date.now(),
      placeholderReplaced: initialContent.length > 0,
    }
  }

  private scheduleFlush(sessionId: string): void {
    const active = this.activeSessions.get(sessionId)
    const card = active?.streamingCard
    if (!card || card.flushTimer) {
      return
    }

    if (card.accumulatedText === card.lastFlushedText) {
      return
    }

    card.flushTimer = setTimeout(() => {
      card.flushTimer = null
      void this.flushStreamingCard(sessionId)
    }, STREAM_FLUSH_INTERVAL_MS)
  }

  private async flushStreamingCard(sessionId: string): Promise<void> {
    const active = this.activeSessions.get(sessionId)
    const card = active?.streamingCard
    if (!card || card.accumulatedText === card.lastFlushedText) {
      return
    }

    await this.ensureStreamingOpen(sessionId)

    const content = card.accumulatedText.slice(0, STREAM_MAX_CONTENT_LENGTH)
    const seq = this.nextSequence(sessionId)

    // Replace placeholder with actual content when content appears for the first time
    if (!card.placeholderReplaced && card.accumulatedText.length > 0) {
      // Use updateCardElement to replace placeholder element with actual content element
      await this.larkClient.updateCardElement(
        card.cardId,
        STREAMING_ELEMENT_ID,
        {
          tag: "markdown",
          content,
          element_id: STREAMING_ELEMENT_ID,
        },
        seq,
      )
      card.placeholderReplaced = true
    } else {
      // Continue streaming content updates
      await this.larkClient.streamCardText(card.cardId, STREAMING_ELEMENT_ID, content, seq)
    }

    card.lastFlushedText = card.accumulatedText
  }

  private async forceFlush(sessionId: string): Promise<void> {
    const active = this.activeSessions.get(sessionId)
    const card = active?.streamingCard
    if (!card) {
      return
    }

    if (card.flushTimer) {
      clearTimeout(card.flushTimer)
      card.flushTimer = null
    }

    await this.flushStreamingCard(sessionId)
  }

  private async pauseStreamingForInteraction(
    sessionId: string,
    defaultSummary: string = "(等待操作)",
  ): Promise<string | null> {
    const active = this.activeSessions.get(sessionId)
    if (!active?.streamingCard) {
      return null
    }

    // Generate summary from accumulated text
    const summaryText = active.streamingCard.accumulatedText.slice(0, 100)
    const summary = summaryText.length > 0 ? `${summaryText}...` : defaultSummary

    await this.closeStreamingCard(sessionId, summary)
    return summary
  }

  private async resumeStreamingAfterInteraction(
    sessionId: string,
    _replyToMessageId: string,
    initialContent: string = "",
  ): Promise<void> {
    // Send new streaming card as independent message, not replying to previous message
    await this.createStreamingCard(sessionId, undefined, initialContent)
  }

  private async closeStreamingCard(sessionId: string, summaryText: string): Promise<void> {
    await this.forceFlush(sessionId)

    const active = this.activeSessions.get(sessionId)
    const card = active?.streamingCard
    if (!card) {
      return
    }

    // Delete the "Processing..." indicator before closing
    const seq = this.nextSequence(sessionId)
    await this.larkClient.deleteCardElement(card.cardId, PROCESSING_ELEMENT_ID, seq)

    const closeSettings = buildStreamingCloseSettings(summaryText)
    const finalSeq = this.nextSequence(sessionId)
    await this.larkClient.updateCardSettings(card.cardId, closeSettings, finalSeq)

    await this.sessionService.setWorkingMessageId(sessionId, null)
    active.streamingCard = undefined
  }

  private async ensureStreamingOpen(sessionId: string): Promise<void> {
    const active = this.activeSessions.get(sessionId)
    const card = active?.streamingCard
    if (!card) {
      return
    }

    const elapsed = Date.now() - card.streamingOpenedAt
    if (card.streamingOpen && elapsed < STREAM_AUTO_CLOSE_MS) {
      return
    }

    // Re-open streaming mode
    const seq = this.nextSequence(sessionId)
    await this.larkClient.updateCardSettings(
      card.cardId,
      {
        config: {
          streaming_mode: true,
          summary: { content: "[生成中...]" },
        },
      },
      seq,
    )

    card.streamingOpen = true
    card.streamingOpenedAt = Date.now()
  }

  private nextSequence(sessionId: string): number {
    const active = this.activeSessions.get(sessionId)
    const card = active?.streamingCard
    if (!card) {
      return 0
    }
    card.sequence++
    return card.sequence
  }

  private cleanupSession(sessionId: string): void {
    const active = this.activeSessions.get(sessionId)
    if (active) {
      for (const resolver of active.permissionResolvers.values()) {
        clearTimeout(resolver.timer)
      }
      if (active.streamingCard?.flushTimer) {
        clearTimeout(active.streamingCard.flushTimer)
      }
    }
    this.activeSessions.delete(sessionId)
  }

  shutdown(): void {
    this.processManager.killAll()
    for (const active of this.activeSessions.values()) {
      for (const resolver of active.permissionResolvers.values()) {
        clearTimeout(resolver.timer)
      }
      if (active.streamingCard?.flushTimer) {
        clearTimeout(active.streamingCard.flushTimer)
      }
    }
    this.activeSessions.clear()
  }
}
