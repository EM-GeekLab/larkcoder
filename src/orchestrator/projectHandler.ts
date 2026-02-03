import { randomUUID } from "node:crypto"
import { dash } from "radashi"
import type { ProcessManager } from "../agent/processManager"
import type { AppConfig } from "../config/schema"
import type { LarkClient } from "../lark/client"
import type { CardAction, ParsedMessage } from "../lark/types"
import type { ProjectService } from "../project/service"
import type { SessionService } from "../session/service"
import type { Session } from "../session/types"
import type { Logger } from "../utils/logger"
import type { SelectProjectResult } from "./types"
import { createAcpClient } from "../agent/acpClient"
import {
  buildMarkdownCard,
  buildProjectCreateCard,
  buildProjectEditCard,
  buildProjectInfoCard,
  buildProjectListCard,
} from "../lark/cards/index"
import { extractErrorMessage } from "../utils/errors"

export class ProjectHandler {
  private activeProjects = new Map<string, string>()

  constructor(
    private projectService: ProjectService,
    private sessionService: SessionService,
    private processManager: ProcessManager,
    private config: AppConfig,
    private larkClient: LarkClient,
    private logger: Logger,
  ) {}

  async handleProjectCreate(message: ParsedMessage): Promise<void> {
    const card = buildProjectCreateCard()
    await this.larkClient.replyCard(message.messageId, card)
  }

  async handleListProjects(message: ParsedMessage): Promise<void> {
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

  async selectProject(chatId: string, projectId: string): Promise<SelectProjectResult> {
    this.activeProjects.set(chatId, projectId)
    let projectTitle = projectId.slice(0, 8)

    await this.projectService.touchProject(projectId)
    const project = await this.projectService.findProject(projectId)
    if (project) {
      projectTitle = project.title
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
    const project = await this.projectService.findProject(projectId)
    return project?.title
  }

  async restoreActiveProject(
    chatId: string,
    resolveSession: (message: ParsedMessage) => Promise<Session | null>,
    message: ParsedMessage,
  ): Promise<void> {
    if (this.activeProjects.has(chatId)) {
      return
    }

    const session = await resolveSession(message)
    if (session?.projectId) {
      this.activeProjects.set(chatId, session.projectId)
      return
    }
  }

  async getProjectWorkingDir(projectId: string): Promise<string | undefined> {
    const project = await this.projectService.findProject(projectId)
    if (!project) {
      return undefined
    }
    return this.projectService.getProjectWorkingDir(project)
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
}
