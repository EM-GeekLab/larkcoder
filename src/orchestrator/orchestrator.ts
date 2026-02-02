import type { ProcessManager } from "../agent/processManager.js"
import type { AgentClient } from "../agent/types.js"
import type { AppConfig } from "../config/schema.js"
import type { LarkClient } from "../lark/client.js"
import type { DocService } from "../lark/docService.js"
import type { CardAction, ParsedMessage } from "../lark/types.js"
import type { SessionService } from "../session/service.js"
import type { Session } from "../session/types.js"
import type { Logger } from "../utils/logger.js"
import type { ActiveSession } from "./types.js"
import { createAcpClient } from "../agent/acpClient.js"
import { CommandHandler, MODE_DISPLAY } from "../command/handler.js"
import { parseCommand } from "../command/parser.js"
import {
  buildModeSelectCard,
  buildModelSelectCard,
  buildSessionDeleteCard,
  buildSessionListCard,
} from "../lark/cards/index.js"
import { createDocTools } from "../lark/docTools.js"
import { extractErrorMessage } from "../utils/errors.js"
import { CardActionHandler } from "./cardActionHandler.js"
import { PermissionManager } from "./permissionManager.js"
import { SessionUpdateHandler } from "./sessionUpdateHandler.js"
import { StreamingCardManager } from "./streamingCardManager.js"

export class Orchestrator {
  private activeSessions = new Map<string, ActiveSession>()
  private sessionMutexes = new Map<string, Promise<void>>()
  private commandHandler: CommandHandler
  private streamingCardManager: StreamingCardManager
  private permissionManager: PermissionManager
  private sessionUpdateHandler: SessionUpdateHandler
  private cardActionHandler: CardActionHandler

  constructor(
    private config: AppConfig,
    private sessionService: SessionService,
    private processManager: ProcessManager,
    private larkClient: LarkClient,
    private docService: DocService,
    private logger: Logger,
  ) {
    const getActiveSession = (id: string) => this.activeSessions.get(id)
    const withSessionLock = <T>(id: string, fn: () => Promise<T>) => this.withSessionLock(id, fn)

    this.streamingCardManager = new StreamingCardManager(
      larkClient,
      sessionService,
      logger,
      withSessionLock,
      getActiveSession,
    )

    this.permissionManager = new PermissionManager(
      larkClient,
      sessionService,
      logger,
      this.streamingCardManager,
      getActiveSession,
    )

    this.sessionUpdateHandler = new SessionUpdateHandler(
      larkClient,
      this.streamingCardManager,
      sessionService,
      logger,
      getActiveSession,
      withSessionLock,
    )

    this.cardActionHandler = new CardActionHandler(
      larkClient,
      sessionService,
      logger,
      this.permissionManager,
      processManager,
      (id) => this.stopSession(id),
      (id) => this.cleanupSession(id),
      getActiveSession,
    )

    this.commandHandler = new CommandHandler(this, sessionService, larkClient, logger)
  }

  async handleMessage(message: ParsedMessage): Promise<void> {
    const threadId = message.rootId ?? message.messageId

    const parsed = parseCommand(message.text)
    if (parsed) {
      await this.commandHandler.handle(parsed, message, threadId)
      return
    }

    const session = await this.resolveSession(message)

    if (session) {
      if (session.status === "running") {
        await this.larkClient.replyMarkdownCard(
          message.messageId,
          "Agent is currently working. Please wait.",
        )
        return
      }

      await this.runInSession(session.id, message.text, message.messageId)
    } else {
      await this.handleNewSession(message, message.messageId)
    }
  }

  async handleCardAction(action: CardAction): Promise<void> {
    await this.cardActionHandler.handleCardAction(action)
  }

  async resolveSession(message: ParsedMessage): Promise<Session | null> {
    if (message.chatType === "p2p") {
      return this.sessionService.findSessionForChat(message.chatId)
    }

    if (message.rootId) {
      return this.sessionService.findSessionForThread(message.rootId)
    }

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
    } else {
      await this.larkClient.replyMarkdownCard(replyToMessageId, "New session created.")
    }
  }

  async handleListSessions(message: ParsedMessage): Promise<void> {
    const sessions = await this.sessionService.listSessions(message.chatId, 10)
    if (sessions.length === 0) {
      await this.larkClient.replyMarkdownCard(message.messageId, "No sessions found in this chat.")
      return
    }

    const current = await this.resolveSession(message)
    const card = buildSessionListCard({ sessions, currentSessionId: current?.id })
    await this.larkClient.replyCard(message.messageId, card)
  }

  async handleDeleteSessions(message: ParsedMessage): Promise<void> {
    const sessions = await this.sessionService.listSessions(message.chatId, 10)
    if (sessions.length === 0) {
      await this.larkClient.replyMarkdownCard(message.messageId, "No sessions found in this chat.")
      return
    }

    const current = await this.resolveSession(message)
    const card = buildSessionDeleteCard({ sessions, currentSessionId: current?.id })
    await this.larkClient.replyCard(message.messageId, card)
  }

  async handleModelSelect(sessionId: string, message: ParsedMessage): Promise<void> {
    const session = await this.sessionService.getSession(sessionId)
    await this.ensureAgentSession(session)

    const active = this.activeSessions.get(sessionId)
    const models = active?.availableModels ?? []

    if (models.length === 0) {
      await this.larkClient.replyMarkdownCard(message.messageId, "No models available.")
      return
    }

    const card = buildModelSelectCard({
      sessionId,
      currentModel: active?.currentModel,
      models: models.map((m) => ({ modelId: m.modelId, label: m.name })),
    })
    await this.larkClient.replyCard(message.messageId, card)
  }

  async handleModeSelect(sessionId: string, message: ParsedMessage): Promise<void> {
    const session = await this.sessionService.getSession(sessionId)
    const modes = Object.entries(MODE_DISPLAY).map(([modeId, label]) => ({ modeId, label }))
    const card = buildModeSelectCard({ sessionId, currentMode: session.mode, modes })
    await this.larkClient.replyCard(message.messageId, card)
  }

  async runInSession(sessionId: string, prompt: string, replyToMessageId: string): Promise<void> {
    const session = await this.sessionService.getSession(sessionId)

    if (!session.initialPrompt) {
      await this.sessionService.setInitialPrompt(sessionId, prompt)
    }

    try {
      await this.ensureAgentSession(session)

      await this.sessionService.setRunning(sessionId)

      const active = this.activeSessions.get(sessionId)!
      await this.streamingCardManager.createStreamingCard(active, replyToMessageId, "")

      this.logger
        .withMetadata({ sessionId, promptLength: prompt.length })
        .debug("Sending prompt to agent")

      const response = await active.client.prompt({
        sessionId: active.acpSessionId,
        prompt: [{ type: "text", text: prompt }],
      })

      this.logger
        .withMetadata({ sessionId, stopReason: response.stopReason })
        .info("Prompt completed")

      await this.withSessionLock(sessionId, async () => {
        const summaryText = active.streamingCard?.accumulatedText ?? ""
        const summary =
          summaryText.length > 100
            ? `${summaryText.slice(0, 100)}...`
            : summaryText || "(no output)"
        await this.streamingCardManager.closeStreamingCard(active, summary)
      })

      await this.sessionService.setIdle(sessionId)
    } catch (error: unknown) {
      const msg = extractErrorMessage(error)
      this.logger.withError(error as Error).error(`Prompt failed for session ${sessionId}`)

      await this.withSessionLock(sessionId, async () => {
        const activeErr = this.activeSessions.get(sessionId)
        if (activeErr?.streamingCard) {
          activeErr.streamingCard.accumulatedText += `\n\n**Error:** ${msg}`
          await this.streamingCardManager.forceFlush(activeErr)
          await this.streamingCardManager.closeStreamingCard(activeErr, `Error: ${msg}`)
        } else {
          await this.larkClient.replyMarkdownCard(replyToMessageId, `**Error:** ${msg}`)
        }
      })

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
      await this.withSessionLock(sessionId, async () => {
        if (active.streamingCard) {
          active.streamingCard.accumulatedText += "\n\n*Stopped.*"
          await this.streamingCardManager.forceFlush(active)
          await this.streamingCardManager.closeStreamingCard(active, "Stopped.")
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

    if (!this.processManager.isAlive(session.id)) {
      this.processManager.spawn(session.id, session.workingDir)
    }

    const child = this.processManager.getProcess(session.id)
    if (!child) {
      throw new Error(`No process for session ${session.id}`)
    }

    const docContext = await this.docService.buildDocContext(session.docToken)
    const systemPrompt = [this.config.agent.systemPrompt, docContext].filter(Boolean).join("\n")

    const acpClient = createAcpClient({
      process: child,
      logger: this.logger,
      onSessionUpdate: (params) =>
        this.sessionUpdateHandler.handleSessionUpdate(session.id, params),
      onPermissionRequest: (params) =>
        this.permissionManager.handlePermissionRequest(session.id, params),
      tools: createDocTools(this.larkClient),
    })

    this.logger.withMetadata({ sessionId: session.id }).debug("Initializing ACP connection")
    await acpClient.initialize()

    let acpSessionId: string
    let modelState: {
      availableModels: Array<{ modelId: string; name: string }>
      currentModelId: string
    } | null = null

    if (session.acpSessionId) {
      this.logger.withMetadata({ sessionId: session.id }).debug("Resuming ACP session")
      const resumeResponse = await acpClient.resumeSession({
        sessionId: session.acpSessionId,
        cwd: session.workingDir,
      })
      acpSessionId = session.acpSessionId
      modelState = resumeResponse.models ?? null
    } else {
      this.logger.withMetadata({ sessionId: session.id }).debug("Creating new ACP session")
      const sessionResponse = await acpClient.newSession({
        cwd: session.workingDir,
        mcpServers: [],
        _meta: systemPrompt ? { systemPrompt } : undefined,
      })
      acpSessionId = sessionResponse.sessionId
      modelState = sessionResponse.models ?? null
      await this.sessionService.setAcpSessionId(session.id, acpSessionId)
    }

    this.activeSessions.set(session.id, {
      sessionId: session.id,
      client: acpClient,
      acpSessionId,
      availableCommands: [],
      availableModels: modelState?.availableModels ?? [],
      currentMode: "",
      currentModel: modelState?.currentModelId,
      permissionResolvers: new Map(),
      toolCallElements: new Map(),
      cardSequences: new Map(),
    })

    if (session.mode !== "default") {
      await this.setSessionMode(session.id, session.mode)
    }
  }

  private withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.sessionMutexes.get(sessionId) ?? Promise.resolve()
    let resolve!: () => void
    const next = new Promise<void>((r) => {
      resolve = r
    })
    this.sessionMutexes.set(sessionId, next)
    const run = async (): Promise<T> => {
      await prev
      try {
        return await fn()
      } finally {
        resolve()
      }
    }
    return run()
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
