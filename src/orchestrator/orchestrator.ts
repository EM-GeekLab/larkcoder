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
  buildModelSelectCard,
  buildPermissionCard,
  buildPermissionSelectedCard,
  buildSelectedCard,
  buildSessionDeleteCard,
  buildSessionListCard,
  buildStreamingCard,
  buildStreamingCloseSettings,
  buildStreamingMarkdownElement,
  buildToolCallElement,
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

type ToolCallElementInfo = {
  elementId: string
  cardId: string
  kind?: string
  title: string
}

type StreamingCard = {
  cardId: string
  messageId: string

  activeElementId: string | null
  elementCounter: number

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
  streamingCardPending?: Promise<void>
  permissionResolvers: Map<string, PermissionResolver>
  toolCallElements: Map<string, ToolCallElementInfo>
  cardSequences: Map<string, number>
}

export class Orchestrator {
  private activeSessions = new Map<string, ActiveSession>()
  private sessionMutexes = new Map<string, Promise<void>>()
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
          await this.handleSessionSelect(action.sessionId, action.openMessageId)
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
      await this.withSessionLock(sessionId, async () => {
        const summaryText = active!.streamingCard?.accumulatedText ?? ""
        const summary =
          summaryText.length > 100
            ? `${summaryText.slice(0, 100)}...`
            : summaryText || "(no output)"
        await this.closeStreamingCard(sessionId, summary)
      })

      // Set idle
      await this.sessionService.setIdle(sessionId)
    } catch (error: unknown) {
      const msg = extractErrorMessage(error)
      this.logger.withError(error as Error).error(`Prompt failed for session ${sessionId}`)

      // Append error to streaming card and close
      await this.withSessionLock(sessionId, async () => {
        const activeErr = this.activeSessions.get(sessionId)
        if (activeErr?.streamingCard) {
          activeErr.streamingCard.accumulatedText += `\n\n**Error:** ${msg}`
          await this.forceFlush(sessionId)
          await this.closeStreamingCard(sessionId, `Error: ${msg}`)
        } else {
          // No streaming card — fallback to markdown card
          await this.larkClient.replyMarkdownCard(replyToMessageId, `**Error:** ${msg}`)
        }
      })

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
      await this.withSessionLock(sessionId, async () => {
        if (active.streamingCard) {
          active.streamingCard.accumulatedText += "\n\n*Stopped.*"
          await this.forceFlush(sessionId)
          await this.closeStreamingCard(sessionId, "Stopped.")
        }
      })

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

  async setSessionMode(sessionId: string, modeId: string): Promise<void> {
    const active = this.activeSessions.get(sessionId)
    if (!active) {
      return
    }
    await active.client.setSessionMode({
      sessionId: active.acpSessionId,
      modeId,
    })
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
      toolCallElements: new Map(),
      cardSequences: new Map(),
    })

    if (session.isPlanMode) {
      await this.setSessionMode(session.id, "plan")
    }
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

    // Resolve the permission promise
    resolver.resolve({
      outcome: { outcome: "selected", optionId },
    })
  }

  private async handleSessionSelect(sessionId: string, cardMessageId: string): Promise<void> {
    try {
      const session = await this.sessionService.getSession(sessionId)
      const label = session.initialPrompt.slice(0, 50)

      // Touch session to make it the most recent for resolveSession
      await this.sessionService.touchSession(sessionId)

      // Update card to show selection
      await this.larkClient.updateCard(
        cardMessageId,
        buildSelectedCard(`Resumed session: ${label}`),
      )
    } catch (error: unknown) {
      this.logger.withError(error as Error).warn(`Session not found: ${sessionId}`)
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
    } catch (error: unknown) {
      this.logger.withError(error as Error).warn(`Session not found for deletion: ${sessionId}`)
      await this.larkClient.updateCard(cardMessageId, buildSelectedCard("Session not found"))
    }
  }

  private async withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.sessionMutexes.get(sessionId) ?? Promise.resolve()
    let resolve!: () => void
    const next = new Promise<void>((r) => {
      resolve = r
    })
    this.sessionMutexes.set(sessionId, next)
    await prev
    try {
      return await fn()
    } finally {
      resolve()
    }
  }

  private async handleSessionUpdate(
    sessionId: string,
    params: acp.SessionNotification,
  ): Promise<void> {
    await this.withSessionLock(sessionId, async () => {
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
          if (text) {
            this.logger
              .withMetadata({ sessionId, textLength: text.length })
              .trace("Agent message chunk")
            await this.ensureStreamingCard(sessionId)
            if (active.streamingCard) {
              active.streamingCard.accumulatedText += text
              this.scheduleFlush(sessionId)
            }
          }
          break
        }
        case "current_mode_update": {
          const modeId = (update as Record<string, unknown>).currentModeId as string | undefined
          if (modeId) {
            this.logger.withMetadata({ sessionId, modeId }).trace("Mode update")
            active.currentMode = modeId
            await this.sessionService.setPlanMode(sessionId, modeId === "plan")
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
        case "tool_call": {
          const title = (update as Record<string, unknown>).title as string | undefined
          const kind = (update as Record<string, unknown>).kind as string | undefined
          const toolCallId = (update as Record<string, unknown>).toolCallId as string | undefined
          this.logger
            .withMetadata({ sessionId, toolCallId, tool: title, kind })
            .debug("Agent tool call")
          if (title) {
            // Check if this tool call already has an element — update in-place
            const existing = toolCallId ? active.toolCallElements.get(toolCallId) : undefined
            if (existing) {
              const updatedKind = kind ?? existing.kind
              const seq = this.nextSequenceForCard(active, existing.cardId)
              await this.larkClient.updateCardElement(
                existing.cardId,
                existing.elementId,
                buildToolCallElement(existing.elementId, title, updatedKind),
                seq,
              )
              existing.title = title
              if (updatedKind !== undefined) {
                existing.kind = updatedKind
              }
            } else {
              // New tool call — create element
              await this.ensureStreamingCard(sessionId)
              if (active.streamingCard) {
                await this.forceFlush(sessionId)
                if (!active.streamingCard.placeholderReplaced) {
                  const seq = this.nextSequence(sessionId)
                  await this.larkClient.deleteCardElement(active.streamingCard.cardId, "md_0", seq)
                  active.streamingCard.placeholderReplaced = true
                  active.streamingCard.activeElementId = null
                }
                const toolElementId = this.nextElementId(sessionId, "tool")
                await this.insertElement(
                  sessionId,
                  buildToolCallElement(toolElementId, title, kind),
                )
                const card = active.streamingCard
                if (!card) {
                  break
                }
                if (toolCallId) {
                  active.toolCallElements.set(toolCallId, {
                    elementId: toolElementId,
                    cardId: card.cardId,
                    kind,
                    title,
                  })
                }
                card.activeElementId = null
                card.accumulatedText = ""
                card.lastFlushedText = ""
              }
            }
          }
          break
        }
        case "tool_call_update": {
          const toolCallId = (update as Record<string, unknown>).toolCallId as string | undefined
          const status = (update as Record<string, unknown>).status as string | undefined
          const newTitle = (update as Record<string, unknown>).title as string | undefined | null
          const newKind = (update as Record<string, unknown>).kind as string | undefined | null
          this.logger
            .withMetadata({ sessionId, toolCallId, status, title: newTitle, kind: newKind })
            .debug("Agent tool call update")
          if (toolCallId) {
            const info = active.toolCallElements.get(toolCallId)
            if (info) {
              const updatedTitle = newTitle != null ? newTitle : info.title
              const updatedKind = newKind != null ? newKind : info.kind
              if (status === "completed" || status === "failed") {
                const seq = this.nextSequenceForCard(active, info.cardId)
                await this.larkClient.updateCardElement(
                  info.cardId,
                  info.elementId,
                  buildToolCallElement(info.elementId, updatedTitle, updatedKind, status),
                  seq,
                )
              }
              info.title = updatedTitle
              if (updatedKind !== undefined) {
                info.kind = updatedKind
              }
            }
          }
          break
        }
        default:
          break
      }
    })
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

    active.cardSequences.set(cardId, 0)
    active.streamingCard = {
      cardId,
      messageId,
      activeElementId: "md_0",
      elementCounter: 0,
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
      void this.withSessionLock(sessionId, () => this.flushStreamingCard(sessionId))
    }, STREAM_FLUSH_INTERVAL_MS)
  }

  private nextElementId(sessionId: string, prefix: string): string {
    const card = this.activeSessions.get(sessionId)?.streamingCard
    if (!card) {
      return `${prefix}_0`
    }
    card.elementCounter++
    return `${prefix}_${card.elementCounter}`
  }

  private async insertElement(sessionId: string, element: Record<string, unknown>): Promise<void> {
    const card = this.activeSessions.get(sessionId)?.streamingCard
    if (!card) {
      return
    }
    const seq = this.nextSequence(sessionId)
    await this.larkClient.addCardElements(
      card.cardId,
      "insert_before",
      PROCESSING_ELEMENT_ID,
      [element],
      seq,
    )
  }

  private async ensureActiveElement(sessionId: string): Promise<string | null> {
    const card = this.activeSessions.get(sessionId)?.streamingCard
    if (!card) {
      return null
    }
    if (card.activeElementId) {
      return card.activeElementId
    }

    const newId = this.nextElementId(sessionId, "md")
    await this.insertElement(sessionId, buildStreamingMarkdownElement(newId))
    card.activeElementId = newId
    return newId
  }

  private async flushStreamingCard(sessionId: string): Promise<void> {
    const active = this.activeSessions.get(sessionId)
    const card = active?.streamingCard
    if (!card || card.accumulatedText === card.lastFlushedText) {
      return
    }

    await this.ensureStreamingOpen(sessionId)

    const elementId = await this.ensureActiveElement(sessionId)
    if (!elementId) {
      return
    }

    const content = card.accumulatedText.slice(0, STREAM_MAX_CONTENT_LENGTH)
    const seq = this.nextSequence(sessionId)

    if (!card.placeholderReplaced) {
      await this.larkClient.updateCardElement(
        card.cardId,
        "md_0",
        { tag: "markdown", content, element_id: "md_0" },
        seq,
      )
      card.placeholderReplaced = true
    } else {
      await this.larkClient.streamCardText(card.cardId, elementId, content, seq)
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
    return this.withSessionLock(sessionId, async () => {
      const active = this.activeSessions.get(sessionId)
      if (!active?.streamingCard) {
        return null
      }

      // Generate summary from accumulated text
      const summaryText = active.streamingCard.accumulatedText.slice(0, 100)
      const summary = summaryText.length > 0 ? `${summaryText}...` : defaultSummary

      await this.closeStreamingCard(sessionId, summary)
      return summary
    })
  }

  private async ensureStreamingCard(sessionId: string): Promise<void> {
    const active = this.activeSessions.get(sessionId)
    if (!active || active.streamingCard) {
      return
    }
    if (active.streamingCardPending) {
      await active.streamingCardPending
      return
    }
    active.streamingCardPending = this.createStreamingCard(sessionId, undefined, "")
    try {
      await active.streamingCardPending
    } finally {
      active.streamingCardPending = undefined
    }
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
    const cardId = active?.streamingCard?.cardId
    if (!active || !cardId) {
      return 0
    }
    return this.nextSequenceForCard(active, cardId)
  }

  private nextSequenceForCard(active: ActiveSession, cardId: string): number {
    const seq = (active.cardSequences.get(cardId) ?? 0) + 1
    active.cardSequences.set(cardId, seq)
    return seq
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
    this.sessionMutexes.delete(sessionId)
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
