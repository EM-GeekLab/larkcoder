import type { ProcessManager } from "../agent/processManager"
import type { LarkClient } from "../lark/client"
import type { CardAction } from "../lark/types"
import type { SessionService } from "../session/service"
import type { Logger } from "../utils/logger"
import type { PermissionManager } from "./permissionManager"
import type { ActiveSessionLookup, ProjectCallbacks } from "./types"
import { buildConfigValueSelectCard, buildSelectedCard } from "../lark/cards/index"

export class CardActionHandler {
  constructor(
    private larkClient: LarkClient,
    private sessionService: SessionService,
    private logger: Logger,
    private permissionManager: PermissionManager,
    private processManager: ProcessManager,
    private stopSession: (sessionId: string) => Promise<void>,
    private cleanupSession: (sessionId: string) => void,
    private getActiveSession: ActiveSessionLookup,
    private projectCallbacks: ProjectCallbacks,
    private runCommand: (sessionId: string, command: string, replyTo: string) => Promise<void>,
  ) {}

  async handleCardAction(action: CardAction): Promise<void> {
    switch (action.action) {
      case "permission_select":
        if (action.sessionId && action.optionId) {
          await this.permissionManager.handlePermissionSelect(
            action.sessionId,
            action.optionId,
            action.openMessageId,
          )
        }
        break

      case "session_select":
        if (action.sessionId) {
          await this.handleSessionSelect(action.sessionId, action.openChatId, action.openMessageId)
        }
        break

      case "model_select":
        if (action.sessionId && action.modelId) {
          await this.handleModelSelectAction(action.sessionId, action.modelId, action.openMessageId)
        }
        break

      case "mode_select":
        if (action.sessionId && action.modeId) {
          await this.handleModeSelectAction(action.sessionId, action.modeId, action.openMessageId)
        }
        break

      case "config_detail":
        if (action.sessionId && action.configId) {
          await this.handleConfigDetailAction(
            action.sessionId,
            action.configId,
            action.openMessageId,
          )
        }
        break

      case "config_select":
        if (action.sessionId && action.configId && action.configValue) {
          await this.handleConfigSelectAction(
            action.sessionId,
            action.configId,
            action.configValue,
            action.openMessageId,
          )
        }
        break

      case "command_select":
        if (action.sessionId && action.commandName) {
          await this.handleCommandSelectAction(
            action.sessionId,
            action.commandName,
            action.openMessageId,
          )
        }
        break

      case "session_delete":
        if (action.sessionId) {
          await this.handleSessionDeleteAction(action.sessionId, action.openMessageId)
        }
        break

      case "project_create":
        await this.projectCallbacks.handleFormSubmit(action)
        break

      case "project_edit":
        await this.projectCallbacks.handleEditFormSubmit(action)
        break

      case "project_cancel":
        await this.larkClient.updateCard(action.openMessageId, buildSelectedCard("已取消"))
        break

      case "project_select":
        if (action.projectId) {
          await this.handleProjectSelectAction(
            action.projectId,
            action.openChatId,
            action.openMessageId,
          )
        }
        break

      default:
        this.logger.warn(`Unknown card action: ${action.action}`)
    }
  }

  private async handleSessionSelect(
    sessionId: string,
    chatId: string,
    cardMessageId: string,
  ): Promise<void> {
    try {
      const session = await this.sessionService.getSession(sessionId)
      const label = session.initialPrompt.slice(0, 50)

      await this.sessionService.touchSession(sessionId)

      if (session.projectId) {
        this.projectCallbacks.setActiveProject(chatId, session.projectId)
      } else {
        this.projectCallbacks.clearActiveProject(chatId)
      }

      // TODO: If project is changed, should display the new project name: "Switched to project: <project name>"
      const modeLabel = session.mode === "default" ? "" : `\nMode: ${session.mode}`
      await this.larkClient.updateCard(
        cardMessageId,
        buildSelectedCard(`Resumed session: ${label}${modeLabel}`),
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
    const active = this.getActiveSession(sessionId)
    if (active) {
      try {
        await active.client.setSessionModel({
          sessionId: active.acpSessionId,
          modelId,
        })
        active.currentModel = modelId
      } catch (error: unknown) {
        this.logger.withError(error as Error).error("Failed to set session model")
      }
    }

    await this.larkClient.updateCard(cardMessageId, buildSelectedCard(`Model: ${modelId}`))
  }

  private async handleModeSelectAction(
    sessionId: string,
    modeId: string,
    cardMessageId: string,
  ): Promise<void> {
    await this.sessionService.setMode(sessionId, modeId)
    const active = this.getActiveSession(sessionId)
    if (active) {
      try {
        await active.client.setSessionMode({
          sessionId: active.acpSessionId,
          modeId,
        })
        active.currentMode = modeId
      } catch (error: unknown) {
        this.logger
          .withError(error as Error)
          .error(`Failed to set session mode ${sessionId} to ${modeId}`)
      }
    }
    const display = active?.availableModes.find((m) => m.id === modeId)?.name ?? modeId
    await this.larkClient.updateCard(cardMessageId, buildSelectedCard(`Mode: ${display}`))
  }

  private async handleConfigDetailAction(
    sessionId: string,
    configId: string,
    cardMessageId: string,
  ): Promise<void> {
    const active = this.getActiveSession(sessionId)
    const config = active?.configOptions?.find((c) => c.id === configId)
    if (!config) {
      await this.larkClient.updateCard(cardMessageId, buildSelectedCard("Config option not found."))
      return
    }

    const card = buildConfigValueSelectCard({
      sessionId,
      configId: config.id,
      configName: config.name,
      currentValue: config.currentValue,
      options: config.options,
    })
    await this.larkClient.updateCard(cardMessageId, card)
  }

  private async handleConfigSelectAction(
    sessionId: string,
    configId: string,
    value: string,
    cardMessageId: string,
  ): Promise<void> {
    const active = this.getActiveSession(sessionId)
    if (active) {
      try {
        const result = (await active.client.setSessionConfigOption({
          sessionId: active.acpSessionId,
          configId,
          value,
        })) as { configOptions?: unknown[] }

        if (result.configOptions) {
          active.configOptions = result.configOptions as typeof active.configOptions
        }
      } catch (error: unknown) {
        this.logger.withError(error as Error).error("Failed to set config option")
      }
    }

    const configName = active?.configOptions?.find((c) => c.id === configId)?.name ?? configId
    await this.larkClient.updateCard(cardMessageId, buildSelectedCard(`${configName}: ${value}`))
  }

  private async handleCommandSelectAction(
    sessionId: string,
    commandName: string,
    cardMessageId: string,
  ): Promise<void> {
    await this.larkClient.updateCard(cardMessageId, buildSelectedCard(`/${commandName}`))
    await this.runCommand(sessionId, commandName, cardMessageId)
  }

  private async handleSessionDeleteAction(sessionId: string, cardMessageId: string): Promise<void> {
    try {
      const session = await this.sessionService.getSession(sessionId)
      const label = session.initialPrompt.slice(0, 50)

      if (session.status === "running") {
        await this.stopSession(sessionId)
      } else {
        this.cleanupSession(sessionId)
        this.processManager.kill(sessionId)
      }

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

  private async handleProjectSelectAction(
    projectId: string,
    chatId: string,
    cardMessageId: string,
  ): Promise<void> {
    const result = await this.projectCallbacks.selectProject(chatId, projectId)
    let text = `Switched to project: ${result.projectTitle}`
    if (result.sessionPrompt) {
      text += `\nResumed session: ${result.sessionPrompt}`
    }
    await this.larkClient.updateCard(cardMessageId, buildSelectedCard(text))
  }
}
