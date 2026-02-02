import type * as acp from "@agentclientprotocol/sdk"
import type { LarkClient } from "../lark/client.js"
import type { SessionService } from "../session/service.js"
import type { Logger } from "../utils/logger.js"
import type { StreamingCardManager } from "./streamingCardManager.js"
import { buildToolCallElement } from "../lark/cards/index.js"
import { isSessionMode } from "../session/types.js"
import { formatDuration, type ActiveSessionLookup, type SessionLockFn } from "./types.js"

export class SessionUpdateHandler {
  constructor(
    private larkClient: LarkClient,
    private streamingCardManager: StreamingCardManager,
    private sessionService: SessionService,
    private logger: Logger,
    private getActiveSession: ActiveSessionLookup,
    private withSessionLock: SessionLockFn,
  ) {}

  async handleSessionUpdate(sessionId: string, params: acp.SessionNotification): Promise<void> {
    await this.withSessionLock(sessionId, async () => {
      const update = params.update
      if (!update) {
        return
      }

      const updateType = (update as Record<string, unknown>).sessionUpdate as string | undefined

      this.logger.withMetadata({ sessionId, updateType }).trace("Session update received")

      const active = this.getActiveSession(sessionId)
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
            await this.streamingCardManager.ensureStreamingCard(active)
            if (active.streamingCard) {
              active.streamingCard.accumulatedText += text
              this.streamingCardManager.scheduleFlush(active)
            }
          }
          break
        }
        case "current_mode_update": {
          const modeId = (update as Record<string, unknown>).currentModeId as string | undefined
          if (modeId && isSessionMode(modeId)) {
            this.logger.withMetadata({ sessionId, modeId }).trace("Mode update")
            active.currentMode = modeId
            await this.sessionService.setMode(sessionId, modeId)
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
            const existing = toolCallId ? active.toolCallElements.get(toolCallId) : undefined
            if (existing) {
              const updatedKind = kind ?? existing.kind
              const seq = this.streamingCardManager.nextSequenceForCard(active, existing.cardId)
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
              await this.streamingCardManager.ensureStreamingCard(active)
              if (active.streamingCard) {
                await this.streamingCardManager.forceFlush(active)
                if (!active.streamingCard.placeholderReplaced) {
                  const seq = this.streamingCardManager.nextSequence(active)
                  await this.larkClient.deleteCardElement(active.streamingCard.cardId, "md_0", seq)
                  active.streamingCard.placeholderReplaced = true
                  active.streamingCard.activeElementId = null
                }
                const toolElementId = this.streamingCardManager.nextElementId(active, "tool")
                await this.streamingCardManager.insertElement(
                  active,
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
                    startedAt: Date.now(),
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
                const duration = formatDuration(Date.now() - info.startedAt)
                const seq = this.streamingCardManager.nextSequenceForCard(active, info.cardId)
                await this.larkClient.updateCardElement(
                  info.cardId,
                  info.elementId,
                  buildToolCallElement(info.elementId, updatedTitle, updatedKind, status, duration),
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
}
