import * as Lark from "@larksuiteoapi/node-sdk"
import type { SessionService } from "../session/service"
import type { Logger } from "../utils/logger"
import type { CardAction, ParsedMessage } from "./types"
import { createLarkLogger, getLarkLoggerLevel } from "./logger"

export type MessageHandler = (message: ParsedMessage) => Promise<void>
export type CardActionHandler = (action: CardAction) => Promise<void>

type IMMessageEventData = Parameters<NonNullable<Lark.EventHandles["im.message.receive_v1"]>>[0]

type CardActionEventData = {
  operator?: { open_id?: string }
  action?: { value?: Record<string, string>; form_value?: Record<string, string> }
  context?: { open_message_id?: string; open_chat_id?: string }
}

export class LarkEventHandler {
  private messageHandler?: MessageHandler
  private cardActionHandler?: CardActionHandler

  constructor(private logger: Logger) {}

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler
  }

  onCardAction(handler: CardActionHandler): void {
    this.cardActionHandler = handler
  }

  createEventDispatcher(sessionService: SessionService): Lark.EventDispatcher {
    return new Lark.EventDispatcher({
      logger: createLarkLogger("lark-event"),
      loggerLevel: getLarkLoggerLevel(),
    }).register({
      "im.message.receive_v1": async (data) => {
        const eventId = data.event_id

        // Event dedup
        if (eventId) {
          if (await sessionService.isEventProcessed(eventId)) {
            this.logger.info(`Duplicate event: ${eventId}`)
            return
          }
          await sessionService.markEventProcessed(eventId)
        }

        const message = this.parseIMMessage(data)
        if (message) {
          this.logger
            .withMetadata({
              messageId: message.messageId,
              chatId: message.chatId,
              chatType: message.chatType,
              senderId: message.senderId,
              threadId: message.rootId,
            })
            .info("Received message")

          this.logger
            .withMetadata({ messageId: message.messageId, textLength: message.text.length })
            .debug("Message content")

          if (this.messageHandler) {
            // Fire-and-forget: must return within 3 seconds
            this.messageHandler(message).catch((err: unknown) => {
              this.logger.withError(err as Error).error("Message handler error")
            })
          }
        }
      },

      "card.action.trigger": async (data: CardActionEventData) => {
        const action = this.parseCardAction(data)
        if (action) {
          this.logger
            .withMetadata({
              action: action.action,
              sessionId: action.sessionId,
              openId: action.openId,
            })
            .info("Received card action")

          if (this.cardActionHandler) {
            // Fire-and-forget: must return within 3 seconds
            this.cardActionHandler(action).catch((err: unknown) => {
              this.logger.withError(err as Error).error("Card action handler error")
            })
          }
        }
        return {}
      },
    })
  }

  private parseIMMessage(data: IMMessageEventData): ParsedMessage | null {
    const { sender, message } = data

    if (message.message_type !== "text") {
      this.logger.info(`Ignoring non-text message: ${message.message_type}`)
      return null
    }

    const chatType = message.chat_type as "p2p" | "group"
    let text = ""

    try {
      const content = JSON.parse(message.content) as Record<string, string>
      text = content.text ?? ""
    } catch {
      this.logger.warn("Failed to parse message content")
      return null
    }

    // In group chats, strip @mention prefix
    if (chatType === "group") {
      const mentions = message.mentions
      if (!mentions || mentions.length === 0) {
        // Not mentioned, ignore in group
        return null
      }
      // Remove @mention placeholders like @_user_1
      text = text.replace(/@_user_\d+/g, "").trim()
    }

    if (!text) {
      return null
    }

    return {
      messageId: message.message_id,
      chatId: message.chat_id,
      chatType,
      senderId: sender.sender_id?.open_id ?? "",
      rootId: message.root_id || undefined,
      text,
    }
  }

  private parseCardAction(data: CardActionEventData): CardAction | null {
    const value = data.action?.value
    const formValue = data.action?.form_value

    if (!value || !value.action) {
      return null
    }

    return {
      openId: data.operator?.open_id ?? "",
      openMessageId: data.context?.open_message_id ?? "",
      openChatId: data.context?.open_chat_id ?? "",
      action: value.action,
      sessionId: value.session_id,
      optionId: value.option_id,
      modelId: value.model_id,
      modeId: value.mode_id,
      configId: value.config_id,
      configValue: value.config_value,
      projectId: value.project_id,
      commandName: value.command_name,
      formValue: formValue ?? undefined,
    }
  }
}
