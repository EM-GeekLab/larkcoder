import type * as acp from "@agentclientprotocol/sdk"
import type { LarkClient } from "../lark/client"
import type { SessionService } from "../session/service"
import type { Logger } from "../utils/logger"
import type { StreamingCardManager } from "./streamingCardManager"
import { buildToolCallElement } from "../lark/cards/index"
import { extractToolCallDisplay, resolveLabelForTitle } from "./toolCallDisplay"
import { formatDuration, type ActiveSessionLookup, type SessionLockFn } from "./types"

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

      this.logger
        .withMetadata({ sessionId, updateType: update.sessionUpdate })
        .trace("Session update received")

      const active = this.getActiveSession(sessionId)
      if (!active) {
        return
      }

      switch (update.sessionUpdate) {
        case "agent_message_chunk": {
          if (update.content.type === "text") {
            const text = update.content.text
            this.logger
              .withMetadata({ sessionId, textLength: text.length })
              .trace("Agent message chunk")
            await this.streamingCardManager.ensureStreamingCard(active)
            if (active.streamingCard) {
              await this.streamingCardManager.ensureActiveElementForType(active, "message")
              active.streamingCard.accumulatedText += text
              this.streamingCardManager.scheduleFlush(active)
            }
          }
          break
        }
        case "current_mode_update": {
          const modeId = update.currentModeId
          if (modeId) {
            this.logger.withMetadata({ sessionId, modeId }).trace("Mode update")
            active.currentMode = modeId
            await this.sessionService.setMode(sessionId, modeId)
          }
          break
        }
        case "available_commands_update": {
          active.availableCommands = update.availableCommands
          this.logger
            .withMetadata({ sessionId, commandsCount: update.availableCommands.length })
            .debug("Available commands update")
          break
        }
        case "tool_call": {
          const { toolCallId } = update
          const display = extractToolCallDisplay(update)
          const { title, kind, label } = display
          this.logger
            .withMetadata({ sessionId, toolCallId, tool: title, kind })
            .debug("Agent tool call")
          const existing = toolCallId ? active.toolCallElements.get(toolCallId) : undefined
          if (existing) {
            const updatedKind = kind ?? existing.kind
            const updatedLabel = label ?? existing.label
            if (
              title !== existing.title ||
              updatedKind !== existing.kind ||
              updatedLabel !== existing.label
            ) {
              const seq = this.streamingCardManager.nextSequenceForCard(active, existing.cardId)
              await this.larkClient.updateCardElement(
                existing.cardId,
                existing.elementId,
                buildToolCallElement(
                  existing.elementId,
                  title,
                  updatedKind,
                  undefined,
                  undefined,
                  updatedLabel,
                ),
                seq,
              )
            }
            existing.title = title
            existing.label = updatedLabel
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
                active.streamingCard.activeElementType = null
              }
              const toolElementId = this.streamingCardManager.nextElementId(active, "tool")
              await this.streamingCardManager.insertElement(
                active,
                buildToolCallElement(toolElementId, title, kind, undefined, undefined, label),
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
                  label,
                  title,
                  startedAt: Date.now(),
                })
              }
              card.activeElementId = null
              card.activeElementType = null
              card.accumulatedText = ""
              card.lastFlushedText = ""
            }
          }
          break
        }
        case "agent_thought_chunk": {
          if (update.content.type === "text") {
            const text = update.content.text
            this.logger
              .withMetadata({ sessionId, textLength: text.length })
              .trace("Agent thought chunk")
            await this.streamingCardManager.ensureStreamingCard(active)
            if (active.streamingCard) {
              await this.streamingCardManager.ensureActiveElementForType(active, "thought")
              active.streamingCard.accumulatedText += text
              this.streamingCardManager.scheduleFlush(active)
            }
          }
          break
        }
        case "plan": {
          const { entries } = update
          if (entries) {
            active.currentPlan = entries.map((e) => ({
              content: e.content,
              priority: e.priority,
              status: e.status,
            }))
            this.logger.withMetadata({ sessionId, entryCount: entries.length }).trace("Plan update")
          }
          break
        }
        case "config_option_update": {
          const { configOptions } = update
          if (configOptions) {
            active.configOptions = configOptions
            this.logger
              .withMetadata({ sessionId, optionCount: configOptions.length })
              .trace("Config options update")
          }
          break
        }
        case "session_info_update": {
          const { title } = update
          if (title != null) {
            active.sessionTitle = title
            this.logger.withMetadata({ sessionId, title }).trace("Session info update")
          }
          break
        }
        case "user_message_chunk": {
          break
        }
        case "tool_call_update": {
          const { toolCallId, status, title: newTitle, kind: newKind } = update
          this.logger
            .withMetadata({ sessionId, toolCallId, status, title: newTitle, kind: newKind })
            .debug("Agent tool call update")
          if (toolCallId) {
            const info = active.toolCallElements.get(toolCallId)
            if (info) {
              const updatedTitle = newTitle != null ? newTitle : info.title
              const updatedKind = newKind != null ? newKind : info.kind
              const updatedLabel =
                newKind != null ? resolveLabelForTitle(newKind, updatedTitle) : info.label
              if (status === "completed" || status === "failed") {
                const duration = formatDuration(Date.now() - info.startedAt)
                const seq = this.streamingCardManager.nextSequenceForCard(active, info.cardId)
                await this.larkClient.updateCardElement(
                  info.cardId,
                  info.elementId,
                  buildToolCallElement(
                    info.elementId,
                    updatedTitle,
                    updatedKind,
                    status,
                    duration,
                    updatedLabel,
                  ),
                  seq,
                )
              }
              info.title = updatedTitle
              info.label = updatedLabel
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
