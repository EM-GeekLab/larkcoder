import type * as acp from "@agentclientprotocol/sdk"
import { randomUUID } from "node:crypto"
import { dash } from "radashi"
import type { ProcessManager } from "../agent/processManager"
import type { AgentClient } from "../agent/types"
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
import {
  buildConfigSelectCard,
  buildMarkdownCard,
  buildModeSelectCard,
  buildModelSelectCard,
  buildProjectCreateCard,
  buildProjectEditCard,
  buildProjectInfoCard,
  buildProjectListCard,
  buildSessionDeleteCard,
  buildSessionListCard,
} from "../lark/cards/index"
import { createDocTools } from "../lark/docTools"
import { extractErrorMessage } from "../utils/errors"
import { CardActionHandler } from "./cardActionHandler"
import { PermissionManager } from "./permissionManager"
import { SessionUpdateHandler } from "./sessionUpdateHandler"
import { StreamingCardManager } from "./streamingCardManager"

export class Orchestrator {
  private activeSessions = new Map<string, ActiveSession>()
  private sessionMutexes = new Map<string, Promise<void>>()
  private activeProjects = new Map<string, string>()
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

    this.cardActionHandler = new CardActionHandler(
      larkClient,
      sessionService,
      logger,
      this.permissionManager,
      processManager,
      (id) => this.stopSession(id),
      (id) => this.cleanupSession(id),
      getActiveSession,
      this,
    )

    this.commandHandler = new CommandHandler(this, sessionService, larkClient, logger)
  }

  async handleMessage(message: ParsedMessage): Promise<void> {
    const threadId = message.rootId ?? message.messageId

    const parsed = parseCommand(message.text)
    if (parsed) {
      await this.restoreActiveProject(message)
      await this.commandHandler.handle(parsed, message, threadId)
      return
    }

    const session = await this.resolveSession(message)

    if (session?.projectId && !this.activeProjects.has(message.chatId)) {
      this.activeProjects.set(message.chatId, session.projectId)
    }

    const activeProjectId = this.activeProjects.get(message.chatId)
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

    const activeProjectId = this.activeProjects.get(message.chatId)
    if (activeProjectId && this.projectService) {
      const project = await this.projectService.findProject(activeProjectId)
      if (project) {
        workingDir = this.projectService.getProjectWorkingDir(project)
        projectId = project.id
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
    const activeProjectId = this.activeProjects.get(message.chatId)
    let sessions: Session[]
    let title: string | undefined

    if (listAll || !this.projectService) {
      sessions = await this.sessionService.listSessions(message.chatId, 10)
    } else if (activeProjectId) {
      sessions = await this.sessionService.listSessionsByProject(activeProjectId, 10)
      const project = await this.projectService.findProject(activeProjectId)
      if (project) {
        title = project.title
      }
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
    if (!this.projectService) {
      return descriptions
    }

    const projectIds = [...new Set(sessions.filter((s) => s.projectId).map((s) => s.projectId!))]
    const projectTitles = new Map<string, string>()
    for (const projectId of projectIds) {
      const project = await this.projectService.findProject(projectId)
      if (project) {
        projectTitles.set(projectId, project.title)
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
      models: models.map((m) => ({ modelId: m.modelId, label: m.name })),
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
      modes: modes.map((m) => ({ modeId: m.id, label: m.name })),
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

  getAvailableModes(sessionId: string): Array<{ id: string; name: string }> {
    return this.activeSessions.get(sessionId)?.availableModes ?? []
  }

  getCurrentMode(sessionId: string): string | undefined {
    return this.activeSessions.get(sessionId)?.currentMode
  }

  getCurrentPlan(sessionId: string): PlanEntry[] | undefined {
    return this.activeSessions.get(sessionId)?.currentPlan
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
    const result = (await active.client.setSessionConfigOption({
      sessionId: active.acpSessionId,
      configId,
      value,
    })) as { configOptions?: acp.SessionConfigOption[] }

    if (result.configOptions) {
      active.configOptions = result.configOptions
    }
  }

  getConfigOptions(sessionId: string): acp.SessionConfigOption[] {
    return this.activeSessions.get(sessionId)?.configOptions ?? []
  }

  async handleProjectCreate(message: ParsedMessage): Promise<void> {
    const card = buildProjectCreateCard()
    await this.larkClient.replyCard(message.messageId, card)
  }

  async handleListProjects(message: ParsedMessage): Promise<void> {
    if (!this.projectService) {
      await this.larkClient.replyMarkdownCard(message.messageId, "Project management unavailable.")
      return
    }

    const projects = await this.projectService.listProjects(message.chatId, 10)
    if (projects.length === 0) {
      await this.larkClient.replyMarkdownCard(message.messageId, "No projects found in this chat.")
      return
    }

    const currentProjectId = this.activeProjects.get(message.chatId)
    const card = buildProjectListCard(projects, currentProjectId)
    await this.larkClient.replyCard(message.messageId, card)
  }

  async handleProjectFormSubmit(action: CardAction): Promise<void> {
    if (!this.projectService) {
      return
    }

    const title = action.formValue?.project_title
    const description = action.formValue?.project_description || undefined
    let folderName = action.formValue?.project_folder?.trim() || ""

    if (!title) {
      await this.larkClient.updateCard(
        action.openMessageId,
        buildMarkdownCard("项目标题不能为空", { token: "close_outlined", color: "red" }),
      )
      return
    }

    await this.larkClient.updateCard(
      action.openMessageId,
      buildMarkdownCard("正在准备项目...", { token: "time_outlined" }),
    )

    if (!folderName) {
      folderName = await this.generateFolderName(title, description)
    }

    try {
      const project = await this.projectService.createProject({
        chatId: action.openChatId,
        creatorId: action.openId,
        title,
        description,
        folderName,
      })

      this.activeProjects.set(action.openChatId, project.id)

      await this.larkClient.updateCard(
        action.openMessageId,
        buildMarkdownCard(`项目创建完成: **${title}** (\`${folderName}/\`)`, {
          token: "done_outlined",
          color: "green",
        }),
      )
    } catch (error: unknown) {
      const msg = extractErrorMessage(error)
      this.logger.withError(error as Error).error("Failed to create project")
      await this.larkClient.updateCard(
        action.openMessageId,
        buildMarkdownCard(msg, { token: "close_outlined", color: "red" }),
      )
    }
  }

  async selectProject(
    chatId: string,
    projectId: string,
  ): Promise<{ projectTitle: string; sessionPrompt?: string }> {
    this.activeProjects.set(chatId, projectId)
    let projectTitle = projectId.slice(0, 8)

    if (this.projectService) {
      await this.projectService.touchProject(projectId)
      const project = await this.projectService.findProject(projectId)
      if (project) {
        projectTitle = project.title
      }
    }

    const [recentSession] = await this.sessionService.listSessionsByProject(projectId, 1)
    let sessionPrompt: string | undefined
    if (recentSession) {
      await this.sessionService.touchSession(recentSession.id)
      sessionPrompt = recentSession.initialPrompt.slice(0, 50)
    }

    return { projectTitle, sessionPrompt }
  }

  setActiveProject(chatId: string, projectId: string): void {
    this.activeProjects.set(chatId, projectId)
  }

  getActiveProject(chatId: string): string | undefined {
    return this.activeProjects.get(chatId)
  }

  clearActiveProject(chatId: string): void {
    this.activeProjects.delete(chatId)
  }

  async handleProjectExit(message: ParsedMessage): Promise<void> {
    this.activeProjects.delete(message.chatId)

    const [recentSession] = await this.sessionService.listGlobalSessions(message.chatId, 1)
    let text = "Exited project."
    if (recentSession) {
      await this.sessionService.touchSession(recentSession.id)
      text += `\nResumed session: ${recentSession.initialPrompt.slice(0, 50)}`
    }

    await this.larkClient.replyMarkdownCard(message.messageId, text)
  }

  async handleProjectInfo(message: ParsedMessage): Promise<void> {
    if (!this.projectService) {
      await this.larkClient.replyMarkdownCard(message.messageId, "Project management unavailable.")
      return
    }

    const activeProjectId = this.activeProjects.get(message.chatId)
    if (!activeProjectId) {
      await this.larkClient.replyMarkdownCard(message.messageId, "No active project.")
      return
    }

    const project = await this.projectService.getProject(activeProjectId)
    const card = buildProjectInfoCard(project)
    await this.larkClient.replyCard(message.messageId, card)
  }

  async handleProjectEdit(message: ParsedMessage): Promise<void> {
    if (!this.projectService) {
      await this.larkClient.replyMarkdownCard(message.messageId, "Project management unavailable.")
      return
    }

    const activeProjectId = this.activeProjects.get(message.chatId)
    if (!activeProjectId) {
      await this.larkClient.replyMarkdownCard(message.messageId, "No active project.")
      return
    }

    const project = await this.projectService.getProject(activeProjectId)
    const card = buildProjectEditCard(project)
    await this.larkClient.replyCard(message.messageId, card)
  }

  async handleProjectEditFormSubmit(action: CardAction): Promise<void> {
    if (!this.projectService) {
      return
    }

    const projectId = action.projectId
    if (!projectId) {
      return
    }

    const title = action.formValue?.project_title
    const description = action.formValue?.project_description || undefined
    const folderName = action.formValue?.project_folder?.trim()

    if (!title || !folderName) {
      await this.larkClient.updateCard(
        action.openMessageId,
        buildMarkdownCard("标题和目录名不能为空", { token: "close_outlined", color: "red" }),
      )
      return
    }

    try {
      await this.projectService.updateProject(projectId, { title, description, folderName })
      await this.larkClient.updateCard(
        action.openMessageId,
        buildMarkdownCard(`项目已更新: **${title}** (\`${folderName}/\`)`, {
          token: "done_outlined",
          color: "green",
        }),
      )
    } catch (error: unknown) {
      const msg = extractErrorMessage(error)
      this.logger.withError(error as Error).error("Failed to update project")
      await this.larkClient.updateCard(
        action.openMessageId,
        buildMarkdownCard(msg, { token: "close_outlined", color: "red" }),
      )
    }
  }

  async getProjectName(projectId: string): Promise<string | undefined> {
    if (!this.projectService) {
      return undefined
    }
    const project = await this.projectService.findProject(projectId)
    return project?.title
  }

  private async restoreActiveProject(message: ParsedMessage): Promise<void> {
    if (this.activeProjects.has(message.chatId)) {
      return
    }
    const session = await this.resolveSession(message)
    if (session?.projectId) {
      this.activeProjects.set(message.chatId, session.projectId)
    }
  }

  private async generateFolderName(title: string, description?: string): Promise<string> {
    const tempId = `temp_${randomUUID()}`
    try {
      this.processManager.spawn(tempId, this.config.agent.workingDir)

      const child = this.processManager.getProcess(tempId)
      if (!child) {
        return dash(title)
      }

      let responseText = ""

      const acpClient = createAcpClient({
        process: child,
        logger: this.logger,
        onSessionUpdate: async (params) => {
          const update = params.update as Record<string, unknown> | undefined
          if (!update) {
            return
          }
          const updateType = update.sessionUpdate as string | undefined
          if (updateType === "agent_message_chunk") {
            const content = update.content as Record<string, unknown> | undefined
            const text = content?.text as string | undefined
            if (text) {
              responseText += text
            }
          }
        },
      })

      await acpClient.initialize()
      const session = await acpClient.newSession({
        cwd: this.config.agent.workingDir,
        mcpServers: [],
      })

      const prompt = description
        ? `根据项目标题"${title}"和描述"${description}"，生成一个简短的、全小写、用连字符分隔的英文目录名。只回复目录名本身，不要有任何其它内容。`
        : `根据项目标题"${title}"，生成一个简短的、全小写、用连字符分隔的英文目录名。只回复目录名本身，不要有任何其它内容。`

      await acpClient.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: prompt }],
      })

      this.processManager.kill(tempId)

      const cleaned = responseText.trim().replace(/[`"']/g, "").replace(/\n/g, "").trim()
      if (cleaned && /^[a-z0-9][a-z0-9-]*$/.test(cleaned)) {
        return cleaned
      }

      return dash(title)
    } catch (error: unknown) {
      this.logger.withError(error as Error).warn("Failed to generate folder name via agent")
      this.processManager.kill(tempId)
      return dash(title)
    }
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
    const initResponse = await acpClient.initialize()
    const agentCapabilities = initResponse.agentCapabilities ?? undefined
    const supportsResume = !!agentCapabilities?.sessionCapabilities?.resume

    let acpSessionId: string
    let modelState: {
      availableModels: Array<{ modelId: string; name: string }>
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
