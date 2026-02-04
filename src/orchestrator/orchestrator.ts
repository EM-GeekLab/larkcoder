import type * as acp from "@agentclientprotocol/sdk"
import type { ProcessManager } from "../agent/processManager"
import type { AppConfig } from "../config/schema"
import type { LarkClient } from "../lark/client"
import type { DocService } from "../lark/docService"
import type { CardAction, ParsedMessage } from "../lark/types"
import type { ProjectService } from "../project/service"
import type { SessionService } from "../session/service"
import type { Session } from "../session/types"
import type { Logger } from "../utils/logger"
import type { ActiveSession, PlanEntry } from "./types"
import { createAcpClient } from "../agent/acpClient"
import { CommandHandler } from "../command/handler"
import { parseCommand } from "../command/parser"
import { ShellCommandHandler } from "../command/shellCommandHandler"
import { ShellExecutor } from "../command/shellExecutor"
import {
  buildCommandSelectCard,
  buildConfigSelectCard,
  buildModeSelectCard,
  buildModelSelectCard,
  buildSessionDeleteCard,
  buildSessionListCard,
} from "../lark/cards/index"
import { createDocTools } from "../lark/docTools"
import { extractErrorMessage } from "../utils/errors"
import { CardActionHandler } from "./cardActionHandler"
import { PermissionManager } from "./permissionManager"
import { ProjectHandler } from "./projectHandler"
import { SessionUpdateHandler } from "./sessionUpdateHandler"
import { StreamingCardManager } from "./streamingCardManager"

export class Orchestrator {
  private activeSessions = new Map<string, ActiveSession>()
  private sessionMutexes = new Map<string, Promise<void>>()
  private commandHandler: CommandHandler
  private streamingCardManager: StreamingCardManager
  private permissionManager: PermissionManager
  private sessionUpdateHandler: SessionUpdateHandler
  private cardActionHandler: CardActionHandler
  private projectHandler?: ProjectHandler

  constructor(
    private config: AppConfig,
    private sessionService: SessionService,
    private processManager: ProcessManager,
    private larkClient: LarkClient,
    private docService: DocService,
    private logger: Logger,
    private projectService?: ProjectService,
  ) {
    const getActiveSession = (id: string) => this.activeSessions.get(id)
    const withSessionLock = <T>(id: string, fn: () => Promise<T>) => this.withSessionLock(id, fn)

    this.streamingCardManager = new StreamingCardManager(
      larkClient,
      sessionService,
      logger,
      withSessionLock,
      getActiveSession,
      config.lark.streamFlushInterval,
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

    if (projectService) {
      this.projectHandler = new ProjectHandler(
        projectService,
        sessionService,
        processManager,
        config,
        larkClient,
        logger,
      )
    }

    this.cardActionHandler = new CardActionHandler(
      larkClient,
      sessionService,
      logger,
      this.permissionManager,
      processManager,
      (id) => this.stopSession(id),
      (id) => this.cleanupSession(id),
      getActiveSession,
      {
        handleFormSubmit: (action) =>
          this.projectHandler?.handleProjectFormSubmit(action) ?? Promise.resolve(),
        handleEditFormSubmit: (action) =>
          this.projectHandler?.handleProjectEditFormSubmit(action) ?? Promise.resolve(),
        selectProject: (chatId, projectId) =>
          this.projectHandler?.selectProject(chatId, projectId) ??
          Promise.resolve({ projectTitle: projectId.slice(0, 8) }),
        setActiveProject: (chatId, projectId) =>
          this.projectHandler?.setActiveProject(chatId, projectId),
        clearActiveProject: (chatId) => this.projectHandler?.clearActiveProject(chatId),
      },
      (sessionId, command, replyTo) => this.runInSession(sessionId, `/${command}`, replyTo),
    )

    // Create shell executor and handler
    const shellExecutor = new ShellExecutor(logger)
    const shellCommandHandler = new ShellCommandHandler(
      this,
      sessionService,
      larkClient,
      shellExecutor,
      this.streamingCardManager,
      logger,
      config.shell?.timeout ?? 300000, // 5 minutes default
    )

    this.commandHandler = new CommandHandler(
      this,
      sessionService,
      larkClient,
      logger,
      shellCommandHandler,
    )
  }

  async handleMessage(message: ParsedMessage): Promise<void> {
    const threadId = message.rootId ?? message.messageId

    const parsed = parseCommand(message.text)
    if (parsed) {
      await this.projectHandler?.restoreActiveProject(
        message.chatId,
        (m) => this.resolveSession(m),
        message,
      )
      await this.commandHandler.handle(parsed, message, threadId)
      return
    }

    const session = await this.resolveSession(message)

    if (session?.projectId && this.projectHandler) {
      this.projectHandler.setActiveProject(message.chatId, session.projectId)
    }

    const activeProjectId = this.projectHandler?.getActiveProject(message.chatId)
    const needsNewSession = activeProjectId && (!session || session.projectId !== activeProjectId)

    if (session && !needsNewSession) {
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

    let workingDir = this.config.agent.workingDir
    let projectId: string | undefined

    const activeProjectId = this.projectHandler?.getActiveProject(message.chatId)
    if (activeProjectId && this.projectHandler) {
      const dir = await this.projectHandler.getProjectWorkingDir(activeProjectId)
      if (dir) {
        workingDir = dir
        projectId = activeProjectId
      }
    }

    const session = await this.sessionService.createSession({
      chatId: message.chatId,
      threadId,
      creatorId: message.senderId,
      initialPrompt: message.text,
      workingDir,
      docToken: this.config.lark.docToken,
      projectId,
    })

    this.logger
      .withMetadata({
        sessionId: session.id,
        chatId: session.chatId,
        threadId,
        senderId: message.senderId,
        projectId,
        prompt: session.initialPrompt,
      })
      .info("New session created")

    if (message.text) {
      await this.runInSession(session.id, message.text, replyToMessageId)
    } else {
      await this.larkClient.replyMarkdownCard(replyToMessageId, "New session created.")
    }
  }

  async handleListSessions(message: ParsedMessage, listAll?: boolean): Promise<void> {
    const activeProjectId = this.projectHandler?.getActiveProject(message.chatId)
    let sessions: Session[]
    let title: string | undefined

    if (listAll || !this.projectHandler) {
      sessions = await this.sessionService.listSessions(message.chatId, 10)
    } else if (activeProjectId) {
      sessions = await this.sessionService.listSessionsByProject(activeProjectId, 10)
      title = await this.projectHandler.getProjectName(activeProjectId)
    } else {
      sessions = await this.sessionService.listGlobalSessions(message.chatId, 10)
    }

    if (sessions.length === 0) {
      const hint = title ? `No sessions found in project "${title}".` : "No sessions found."
      await this.larkClient.replyMarkdownCard(message.messageId, hint)
      return
    }

    const current = await this.resolveSession(message)
    const descriptions = title ? undefined : await this.buildProjectDescriptions(sessions)
    const card = buildSessionListCard({
      sessions,
      currentSessionId: current?.id,
      title,
      descriptions,
    })
    await this.larkClient.replyCard(message.messageId, card)
  }

  async handleDeleteSessions(message: ParsedMessage): Promise<void> {
    const sessions = await this.sessionService.listSessions(message.chatId, 10)
    if (sessions.length === 0) {
      await this.larkClient.replyMarkdownCard(message.messageId, "No sessions found in this chat.")
      return
    }

    const current = await this.resolveSession(message)
    const descriptions = await this.buildProjectDescriptions(sessions)
    const card = buildSessionDeleteCard({ sessions, currentSessionId: current?.id, descriptions })
    await this.larkClient.replyCard(message.messageId, card)
  }

  private async buildProjectDescriptions(sessions: Session[]): Promise<Map<string, string>> {
    const descriptions = new Map<string, string>()
    if (!this.projectHandler) {
      return descriptions
    }

    const projectIds = [...new Set(sessions.filter((s) => s.projectId).map((s) => s.projectId!))]
    const projectTitles = new Map<string, string>()
    for (const projectId of projectIds) {
      const title = await this.projectHandler.getProjectName(projectId)
      if (title) {
        projectTitles.set(projectId, title)
      }
    }

    for (const s of sessions) {
      if (s.projectId) {
        const t = projectTitles.get(s.projectId)
        if (t) {
          descriptions.set(s.id, t)
        }
      }
    }
    return descriptions
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
      models: models.map((m) => ({
        modelId: m.modelId,
        label: m.name,
        description: m.description ?? undefined,
      })),
    })
    await this.larkClient.replyCard(message.messageId, card)
  }

  async handleModeSelect(sessionId: string, message: ParsedMessage): Promise<void> {
    const session = await this.sessionService.getSession(sessionId)
    await this.ensureAgentSession(session)

    const active = this.activeSessions.get(sessionId)
    const modes = active?.availableModes ?? []

    if (modes.length === 0) {
      await this.larkClient.replyMarkdownCard(message.messageId, "No modes available.")
      return
    }

    const card = buildModeSelectCard({
      sessionId,
      currentMode: active?.currentMode ?? session.mode,
      modes: modes.map((m) => ({
        modeId: m.id,
        label: m.name,
        description: m.description ?? undefined,
      })),
    })
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
        this.logger
          .withError(new Error(`Failed to cancel session ${sessionId}`))
          .error("Failed to cancel session")
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

  getActiveSession(sessionId: string): ActiveSession | undefined {
    return this.activeSessions.get(sessionId)
  }

  getAvailableCommands(sessionId: string): acp.AvailableCommand[] {
    return this.activeSessions.get(sessionId)?.availableCommands ?? []
  }

  getAvailableModes(
    sessionId: string,
  ): Array<{ id: string; name: string; description?: string | null }> {
    return this.activeSessions.get(sessionId)?.availableModes ?? []
  }

  getCurrentMode(sessionId: string): string | undefined {
    return this.activeSessions.get(sessionId)?.currentMode
  }

  getCurrentModel(sessionId: string): string | undefined {
    return this.activeSessions.get(sessionId)?.currentModel
  }

  getAvailableModels(
    sessionId: string,
  ): Array<{ modelId: string; name: string; description?: string | null }> {
    return this.activeSessions.get(sessionId)?.availableModels ?? []
  }

  getCurrentPlan(sessionId: string): PlanEntry[] | undefined {
    return this.activeSessions.get(sessionId)?.currentPlan
  }

  async setSessionMode(sessionId: string, modeId: string): Promise<void> {
    const active = this.activeSessions.get(sessionId)
    if (!active) {
      return
    }
    await active.client
      .setSessionMode({
        sessionId: active.acpSessionId,
        modeId,
      })
      .then(() => {
        active.currentMode = modeId
      })
      .catch((error: unknown) => {
        this.logger
          .withError(error as Error)
          .error(`Failed to set session mode ${sessionId} to ${modeId}`)
      })
  }

  async handleCommandSelect(sessionId: string, message: ParsedMessage): Promise<void> {
    const session = await this.sessionService.getSession(sessionId)
    await this.ensureAgentSession(session)

    const active = this.activeSessions.get(sessionId)
    const commands = active?.availableCommands ?? []

    if (commands.length === 0) {
      await this.larkClient.replyMarkdownCard(
        message.messageId,
        "No commands available. Send a message first to initialize the session.",
      )
      return
    }

    const card = buildCommandSelectCard({
      sessionId,
      commands: commands.map((c) => ({
        name: c.name,
        description: c.description,
      })),
    })
    await this.larkClient.replyCard(message.messageId, card)
  }

  async handleConfigSelect(sessionId: string, message: ParsedMessage): Promise<void> {
    const session = await this.sessionService.getSession(sessionId)
    await this.ensureAgentSession(session)

    const active = this.activeSessions.get(sessionId)
    const configOptions = active?.configOptions ?? []

    if (configOptions.length === 0) {
      await this.larkClient.replyMarkdownCard(message.messageId, "No config options available.")
      return
    }

    const card = buildConfigSelectCard({ sessionId, configOptions })
    await this.larkClient.replyCard(message.messageId, card)
  }

  async setSessionConfigOption(sessionId: string, configId: string, value: string): Promise<void> {
    const active = this.activeSessions.get(sessionId)
    if (!active) {
      return
    }
    try {
      const result = (await active.client.setSessionConfigOption({
        sessionId: active.acpSessionId,
        configId,
        value,
      })) as { configOptions?: acp.SessionConfigOption[] }

      if (result.configOptions) {
        active.configOptions = result.configOptions
      }
    } catch (error: unknown) {
      this.logger
        .withError(error as Error)
        .error(`Failed to set session config option ${configId} to ${value}`)
    }
  }

  getConfigOptions(sessionId: string): acp.SessionConfigOption[] {
    return this.activeSessions.get(sessionId)?.configOptions ?? []
  }

  async handleProjectCreate(message: ParsedMessage): Promise<void> {
    await this.projectHandler?.handleProjectCreate(message)
  }

  async handleListProjects(message: ParsedMessage): Promise<void> {
    await this.projectHandler?.handleListProjects(message)
  }

  async handleProjectExit(message: ParsedMessage): Promise<void> {
    await this.projectHandler?.handleProjectExit(message)
  }

  async handleProjectInfo(message: ParsedMessage): Promise<void> {
    await this.projectHandler?.handleProjectInfo(message)
  }

  async handleProjectEdit(message: ParsedMessage): Promise<void> {
    await this.projectHandler?.handleProjectEdit(message)
  }

  async getProjectName(projectId: string): Promise<string | undefined> {
    return this.projectHandler?.getProjectName(projectId)
  }

  private async buildProjectContext(projectId?: string): Promise<string | undefined> {
    if (!projectId || !this.projectService) {
      return undefined
    }

    const project = await this.projectService.findProject(projectId)
    if (!project) {
      return undefined
    }

    const parts = [`# Project: ${project.title}`]
    if (project.description) {
      parts.push(`Description: ${project.description}`)
    }

    return parts.join("\n")
  }

  async ensureAgentSession(session: Session): Promise<void> {
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
    const projectContext = await this.buildProjectContext(session.projectId)
    const systemPrompt = [this.config.agent.systemPrompt, docContext, projectContext]
      .filter(Boolean)
      .join("\n")

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
    const initResponse = await acpClient.initialize()
    const agentCapabilities = initResponse.agentCapabilities ?? undefined
    const supportsResume = !!agentCapabilities?.sessionCapabilities?.resume

    let acpSessionId: string
    let modelState: {
      availableModels: Array<{ modelId: string; name: string; description?: string | null }>
      currentModelId: string
    } | null = null
    let modeState: {
      availableModes: Array<{ id: string; name: string; description?: string | null }>
      currentModeId: string
    } | null = null
    let configOptions: acp.SessionConfigOption[] | null = null

    if (session.acpSessionId && supportsResume) {
      this.logger.withMetadata({ sessionId: session.id }).debug("Resuming ACP session")
      const resumeResponse = await acpClient.resumeSession({
        sessionId: session.acpSessionId,
        cwd: session.workingDir,
      })
      acpSessionId = session.acpSessionId
      modelState = resumeResponse.models ?? null
      modeState = resumeResponse.modes ?? null
      configOptions = resumeResponse.configOptions ?? null
    } else {
      this.logger.withMetadata({ sessionId: session.id }).debug("Creating new ACP session")
      const sessionResponse = await acpClient.newSession({
        cwd: session.workingDir,
        mcpServers: [],
        _meta: systemPrompt ? { systemPrompt } : undefined,
      })
      acpSessionId = sessionResponse.sessionId
      modelState = sessionResponse.models ?? null
      modeState = sessionResponse.modes ?? null
      configOptions = sessionResponse.configOptions ?? null
      await this.sessionService.setAcpSessionId(session.id, acpSessionId)
    }

    this.activeSessions.set(session.id, {
      sessionId: session.id,
      client: acpClient,
      acpSessionId,
      availableCommands: [],
      availableModels: modelState?.availableModels ?? [],
      availableModes: modeState?.availableModes ?? [],
      currentMode: modeState?.currentModeId ?? session.mode,
      currentModel: modelState?.currentModelId,
      configOptions: configOptions ?? undefined,
      agentCapabilities,
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
    }
    this.activeSessions.clear()
  }
}
