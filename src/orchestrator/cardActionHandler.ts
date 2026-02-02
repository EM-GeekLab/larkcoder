import type { ProcessManager } from "../agent/processManager.js"
import type { LarkClient } from "../lark/client.js"
import type { CardAction } from "../lark/types.js"
import type { SessionService } from "../session/service.js"
import type { Logger } from "../utils/logger.js"
import type { PermissionManager } from "./permissionManager.js"
import type { ActiveSessionLookup } from "./types.js"
import { buildSelectedCard } from "../lark/cards/index.js"

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
          await this.handleSessionSelect(action.sessionId, action.openMessageId)
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

      case "session_delete":
        if (action.sessionId) {
          await this.handleSessionDeleteAction(action.sessionId, action.openMessageId)
        }
        break

      default:
        this.logger.warn(`Unknown card action: ${action.action}`)
    }
  }

  private async handleSessionSelect(sessionId: string, cardMessageId: string): Promise<void> {
    try {
      const session = await this.sessionService.getSession(sessionId)
      const label = session.initialPrompt.slice(0, 50)

      await this.sessionService.touchSession(sessionId)

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
      await active.client.setSessionMode({
        sessionId: active.acpSessionId,
        modeId,
      })
      active.currentMode = modeId
    }
    const display = active?.availableModes.find((m) => m.id === modeId)?.name ?? modeId
    await this.larkClient.updateCard(cardMessageId, buildSelectedCard(`Mode: ${display}`))
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
}
