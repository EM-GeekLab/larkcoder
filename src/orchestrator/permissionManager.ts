import type * as acp from "@agentclientprotocol/sdk"
import type { LarkClient } from "../lark/client"
import type { SessionService } from "../session/service"
import type { Logger } from "../utils/logger"
import type { StreamingCardManager } from "./streamingCardManager"
import { buildPermissionCard, buildPermissionSelectedCard } from "../lark/cards/index"
import { PERMISSION_TIMEOUT_MS, type ActiveSessionLookup } from "./types"

export class PermissionManager {
  constructor(
    private larkClient: LarkClient,
    private sessionService: SessionService,
    private logger: Logger,
    private streamingCardManager: StreamingCardManager,
    private getActiveSession: ActiveSessionLookup,
  ) {}

  async handlePermissionRequest(
    sessionId: string,
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    await this.streamingCardManager.pauseStreamingForInteraction(sessionId, "(等待授权)")

    const session = await this.sessionService.getSession(sessionId)

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

    return new Promise<acp.RequestPermissionResponse>((resolve) => {
      const timer = setTimeout(() => {
        const active = this.getActiveSession(sessionId)
        active?.permissionResolvers.delete(resolverKey)
        resolve({ outcome: { outcome: "cancelled" } })
      }, PERMISSION_TIMEOUT_MS)

      const active = this.getActiveSession(sessionId)
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

  async handlePermissionSelect(
    sessionId: string,
    optionId: string,
    cardMessageId: string,
  ): Promise<void> {
    const active = this.getActiveSession(sessionId)
    if (!active) {
      return
    }
    const resolver = active.permissionResolvers.get(cardMessageId)
    if (!resolver) {
      return
    }

    clearTimeout(resolver.timer)
    active.permissionResolvers.delete(cardMessageId)

    const selectedOption = resolver.options.find((opt) => opt.optionId === optionId)
    const selectedLabel = selectedOption?.label ?? optionId

    await this.larkClient.updateCard(
      cardMessageId,
      buildPermissionSelectedCard({
        toolDescription: resolver.toolDescription,
        selectedLabel,
      }),
    )

    resolver.resolve({
      outcome: { outcome: "selected", optionId },
    })
  }
}
