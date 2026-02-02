import * as Lark from "@larksuiteoapi/node-sdk"
import type { SessionService } from "../session/service.js"
import type { CardAction, ParsedMessage } from "./types.js"
import { type Logger, createLarkLogger } from "../utils/logger.js"

export type MessageHandler = (message: ParsedMessage) => Promise<void>
export type CardActionHandler = (action: CardAction) => Promise<void>

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
      loggerLevel: Lark.LoggerLevel.error,
    }).register({
      "im.message.receive_v1": async (data: Record<string, unknown>) => {
        const header = data.header as Record<string, unknown> | undefined
        const eventId = (header?.event_id ?? (data as Record<string, unknown>).event_id) as
          | string
          | undefined

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

      "card.action.trigger": async (data: Record<string, unknown>) => {
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

  private parseIMMessage(data: Record<string, unknown>): ParsedMessage | null {
    const sender = data.sender as Record<string, unknown> | undefined
    const senderId = sender?.sender_id as Record<string, string> | undefined
    const message = data.message as Record<string, unknown> | undefined

    if (!message) {
      return null
    }

    const messageType = message.message_type as string
    if (messageType !== "text") {
      this.logger.info(`Ignoring non-text message: ${messageType}`)
      return null
    }

    const chatType = message.chat_type as "p2p" | "group"
    const contentStr = message.content as string
    let text = ""

    try {
      const content = JSON.parse(contentStr) as Record<string, string>
      text = content.text ?? ""
    } catch {
      this.logger.warn("Failed to parse message content")
      return null
    }

    // In group chats, strip @mention prefix
    if (chatType === "group") {
      const mentions = message.mentions as Array<Record<string, unknown>> | undefined
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
      messageId: message.message_id as string,
      chatId: message.chat_id as string,
      chatType,
      senderId: senderId?.open_id ?? "",
      rootId: (message.root_id as string) || undefined,
      text,
    }
  }

  private parseCardAction(data: Record<string, unknown>): CardAction | null {
    const operator = data.operator as Record<string, string> | undefined
    const action = data.action as Record<string, unknown> | undefined
    const context = data.context as Record<string, string> | undefined
    const value = action?.value as Record<string, string> | undefined

    if (!value || !value.action) {
      return null
    }

    return {
      openId: operator?.open_id ?? "",
      openMessageId: context?.open_message_id ?? "",
      openChatId: context?.open_chat_id ?? "",
      action: value.action,
      sessionId: value.session_id,
      optionId: value.option_id,
      modelId: value.model_id,
    }
  }
}
