import * as lark from "@larksuiteoapi/node-sdk"
import type { LarkConfig } from "./types.js"
import { type Logger, createLarkLogger } from "../utils/logger.js"

export class LarkClient {
  readonly sdk: lark.Client
  private wsClient?: lark.WSClient

  constructor(
    private config: LarkConfig,
    private logger: Logger,
  ) {
    this.sdk = new lark.Client({
      appId: config.appId,
      appSecret: config.appSecret,
      logger: createLarkLogger("lark-sdk"),
      loggerLevel: lark.LoggerLevel.error,
    })
  }

  async startWS(eventDispatcher: lark.EventDispatcher): Promise<void> {
    this.wsClient = new lark.WSClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      logger: createLarkLogger("lark-ws"),
      loggerLevel: lark.LoggerLevel.error,
    })
    await this.wsClient.start({ eventDispatcher })
  }

  closeWS(): void {
    this.wsClient?.close()
  }

  async replyText(
    messageId: string,
    text: string,
  ): Promise<string | undefined> {
    try {
      this.logger
        .withMetadata({ messageId, textLength: text.length })
        .debug("Replying text")
      const resp = await this.sdk.im.message.reply({
        path: { message_id: messageId },
        data: {
          content: JSON.stringify({ text }),
          msg_type: "text",
        },
      })
      this.logger
        .withMetadata({ messageId, replyMessageId: resp.data?.message_id })
        .debug("Reply text sent")
      return resp.data?.message_id
    } catch (error: unknown) {
      this.logger.withError(error as Error).error("Failed to reply text")
      return undefined
    }
  }

  async sendText(chatId: string, text: string): Promise<string | undefined> {
    try {
      const resp = await this.sdk.im.message.create({
        data: {
          receive_id: chatId,
          content: JSON.stringify({ text }),
          msg_type: "text",
        },
        params: { receive_id_type: "chat_id" },
      })
      return resp.data?.message_id
    } catch (error: unknown) {
      this.logger.withError(error as Error).error("Failed to send text")
      return undefined
    }
  }

  async sendCard(
    chatId: string,
    card: Record<string, unknown>,
  ): Promise<string | undefined> {
    try {
      const resp = await this.sdk.im.message.create({
        data: {
          receive_id: chatId,
          content: JSON.stringify(card),
          msg_type: "interactive",
        },
        params: { receive_id_type: "chat_id" },
      })
      return resp.data?.message_id
    } catch (error: unknown) {
      this.logger.withError(error as Error).error("Failed to send card")
      return undefined
    }
  }

  async replyCard(
    messageId: string,
    card: Record<string, unknown>,
  ): Promise<string | undefined> {
    try {
      this.logger.withMetadata({ messageId }).debug("Replying card")
      const resp = await this.sdk.im.message.reply({
        path: { message_id: messageId },
        data: {
          content: JSON.stringify(card),
          msg_type: "interactive",
        },
      })
      this.logger
        .withMetadata({ messageId, replyMessageId: resp.data?.message_id })
        .debug("Reply card sent")
      return resp.data?.message_id
    } catch (error: unknown) {
      this.logger.withError(error as Error).error("Failed to reply card")
      return undefined
    }
  }

  async updateCard(
    messageId: string,
    card: Record<string, unknown>,
  ): Promise<void> {
    try {
      this.logger.withMetadata({ messageId }).debug("Updating card")
      await this.sdk.im.message.patch({
        path: { message_id: messageId },
        data: { content: JSON.stringify(card) },
      })
      this.logger.withMetadata({ messageId }).debug("Card updated")
    } catch (error: unknown) {
      this.logger.withError(error as Error).error("Failed to update card")
    }
  }

  async fetchDocContent(docToken: string): Promise<string | null> {
    try {
      const resp = await this.sdk.docx.document.rawContent({
        path: { document_id: docToken },
      })
      return (resp.data?.content as string) ?? null
    } catch (error: unknown) {
      this.logger.withError(error as Error).error("Failed to fetch doc content")
      return null
    }
  }

  async appendDocContent(docToken: string, text: string): Promise<boolean> {
    try {
      await this.sdk.docx.documentBlockChildren.create({
        path: { document_id: docToken, block_id: docToken },
        data: {
          children: [
            {
              block_type: 2,
              text: {
                elements: [{ text_run: { content: text } }],
              },
            },
          ],
        },
        params: { document_revision_id: -1 },
      })
      return true
    } catch (error: unknown) {
      this.logger
        .withError(error as Error)
        .error("Failed to append doc content")
      return false
    }
  }
}
