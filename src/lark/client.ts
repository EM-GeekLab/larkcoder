import * as lark from '@larksuiteoapi/node-sdk'
import type { Logger } from '../utils/logger'
import type { LarkConfig } from './types'
import { buildMarkdownCard } from './cards/index'
import { createLarkLogger, getLarkLoggerLevel } from './logger'

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
      logger: createLarkLogger('lark-sdk'),
      loggerLevel: getLarkLoggerLevel(),
    })
  }

  async startWS(eventDispatcher: lark.EventDispatcher): Promise<void> {
    this.wsClient = new lark.WSClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      logger: createLarkLogger('lark-ws'),
      loggerLevel: getLarkLoggerLevel(),
    })
    await this.wsClient.start({ eventDispatcher })
  }

  closeWS(): void {
    this.wsClient?.close()
  }

  async replyText(messageId: string, text: string): Promise<string | undefined> {
    try {
      this.logger.withMetadata({ messageId, textLength: text.length }).debug('Replying text')
      const resp = await this.sdk.im.message.reply({
        path: { message_id: messageId },
        data: {
          content: JSON.stringify({ text }),
          msg_type: 'text',
        },
      })
      this.logger.withMetadata({ messageId, replyMessageId: resp.data?.message_id }).debug('Reply text sent')
      return resp.data?.message_id
    } catch (error: unknown) {
      this.logger.withError(error as Error).error('Failed to reply text')
      return undefined
    }
  }

  async sendText(chatId: string, text: string): Promise<string | undefined> {
    try {
      const resp = await this.sdk.im.message.create({
        data: {
          receive_id: chatId,
          content: JSON.stringify({ text }),
          msg_type: 'text',
        },
        params: { receive_id_type: 'chat_id' },
      })
      return resp.data?.message_id
    } catch (error: unknown) {
      this.logger.withError(error as Error).error('Failed to send text')
      return undefined
    }
  }

  async sendCard(chatId: string, card: Record<string, unknown>): Promise<string | undefined> {
    try {
      const resp = await this.sdk.im.message.create({
        data: {
          receive_id: chatId,
          content: JSON.stringify(card),
          msg_type: 'interactive',
        },
        params: { receive_id_type: 'chat_id' },
      })
      return resp.data?.message_id
    } catch (error: unknown) {
      this.logger.withError(error as Error).error('Failed to send card')
      return undefined
    }
  }

  async replyCard(messageId: string, card: Record<string, unknown>): Promise<string | undefined> {
    try {
      this.logger.withMetadata({ messageId }).debug('Replying card')
      const resp = await this.sdk.im.message.reply({
        path: { message_id: messageId },
        data: {
          content: JSON.stringify(card),
          msg_type: 'interactive',
        },
      })
      this.logger.withMetadata({ messageId, replyMessageId: resp.data?.message_id }).debug('Reply card sent')
      return resp.data?.message_id
    } catch (error: unknown) {
      this.logger.withError(error as Error).error('Failed to reply card')
      return undefined
    }
  }

  async replyPost(messageId: string, post: Record<string, unknown>): Promise<string | undefined> {
    try {
      this.logger.withMetadata({ messageId }).debug('Replying post')
      const resp = await this.sdk.im.message.reply({
        path: { message_id: messageId },
        data: {
          content: JSON.stringify(post),
          msg_type: 'post',
        },
      })
      this.logger.withMetadata({ messageId, replyMessageId: resp.data?.message_id }).debug('Reply post sent')
      return resp.data?.message_id
    } catch (error: unknown) {
      this.logger.withError(error as Error).error('Failed to reply post')
      return undefined
    }
  }

  async editMessage(messageId: string, msgType: 'text' | 'post', content: string): Promise<void> {
    try {
      this.logger.withMetadata({ messageId, msgType }).debug('Editing message')
      await this.sdk.im.message.update({
        path: { message_id: messageId },
        data: { msg_type: msgType, content },
      })
      this.logger.withMetadata({ messageId }).debug('Message edited')
    } catch (error: unknown) {
      this.logger.withError(error as Error).error('Failed to edit message')
    }
  }

  async updateCard(messageId: string, card: Record<string, unknown>): Promise<void> {
    try {
      this.logger.withMetadata({ messageId }).debug('Updating card')
      await this.sdk.im.message.patch({
        path: { message_id: messageId },
        data: { content: JSON.stringify(card) },
      })
      this.logger.withMetadata({ messageId }).debug('Card updated')
    } catch (error: unknown) {
      this.logger.withError(error as Error).error('Failed to update card')
    }
  }

  async recallMessage(messageId: string): Promise<void> {
    try {
      this.logger.withMetadata({ messageId }).debug('Recalling message')
      await this.sdk.im.message.delete({
        path: { message_id: messageId },
      })
      this.logger.withMetadata({ messageId }).debug('Message recalled')
    } catch (error: unknown) {
      this.logger.withError(error as Error).error('Failed to recall message')
    }
  }

  async sendPost(chatId: string, post: Record<string, unknown>): Promise<string | undefined> {
    try {
      const resp = await this.sdk.im.message.create({
        data: {
          receive_id: chatId,
          content: JSON.stringify(post),
          msg_type: 'post',
        },
        params: { receive_id_type: 'chat_id' },
      })
      return resp.data?.message_id
    } catch (error: unknown) {
      this.logger.withError(error as Error).error('Failed to send post')
      return undefined
    }
  }

  async createCardEntity(cardJson: Record<string, unknown>): Promise<string | undefined> {
    try {
      this.logger.debug('Creating card entity')
      const resp = await this.sdk.cardkit.v1.card.create({
        data: { type: 'card_json', data: JSON.stringify(cardJson) },
      })
      const cardId = resp.data?.card_id
      this.logger.withMetadata({ cardId }).debug('Card entity created')
      return cardId
    } catch (error: unknown) {
      this.logger.withError(error as Error).error('Failed to create card entity')
      return undefined
    }
  }

  async replyCardEntity(messageId: string, cardId: string): Promise<string | undefined> {
    try {
      this.logger.withMetadata({ messageId, cardId }).debug('Replying with card entity')
      const resp = await this.sdk.im.message.reply({
        path: { message_id: messageId },
        data: {
          content: JSON.stringify({ type: 'card', data: { card_id: cardId } }),
          msg_type: 'interactive',
        },
      })
      this.logger
        .withMetadata({ messageId, replyMessageId: resp.data?.message_id })
        .debug('Card entity reply sent')
      return resp.data?.message_id
    } catch (error: unknown) {
      this.logger.withError(error as Error).error('Failed to reply card entity')
      return undefined
    }
  }

  async streamCardText(cardId: string, elementId: string, content: string, sequence: number): Promise<void> {
    try {
      await this.sdk.cardkit.v1.cardElement.content({
        path: { card_id: cardId, element_id: elementId },
        data: { content, sequence },
      })
    } catch (error: unknown) {
      this.logger.withError(error as Error).error('Failed to stream card text')
    }
  }

  async updateCardElement(
    cardId: string,
    elementId: string,
    element: Record<string, unknown>,
    sequence: number,
  ): Promise<void> {
    try {
      await this.sdk.cardkit.v1.cardElement.update({
        path: { card_id: cardId, element_id: elementId },
        data: {
          element: JSON.stringify(element),
          sequence,
        },
      })
    } catch (error: unknown) {
      this.logger.withError(error as Error).error('Failed to update card element')
    }
  }

  async addCardElements(
    cardId: string,
    type: 'insert_before' | 'insert_after' | 'append',
    targetElementId: string | undefined,
    elements: Record<string, unknown>[],
    sequence: number,
  ): Promise<void> {
    try {
      await this.sdk.cardkit.v1.cardElement.create({
        path: { card_id: cardId },
        data: {
          type,
          target_element_id: targetElementId,
          elements: JSON.stringify(elements),
          sequence,
        },
      })
    } catch (error: unknown) {
      this.logger.withError(error as Error).error('Failed to add card elements')
    }
  }

  async deleteCardElement(cardId: string, elementId: string, sequence: number): Promise<void> {
    try {
      await this.sdk.cardkit.v1.cardElement.delete({
        path: { card_id: cardId, element_id: elementId },
        data: { sequence },
      })
    } catch (error: unknown) {
      this.logger.withError(error as Error).error('Failed to delete card element')
    }
  }

  async updateCardSettings(
    cardId: string,
    settings: Record<string, unknown>,
    sequence: number,
  ): Promise<void> {
    try {
      await this.sdk.cardkit.v1.card.settings({
        path: { card_id: cardId },
        data: { settings: JSON.stringify(settings), sequence },
      })
    } catch (error: unknown) {
      this.logger.withError(error as Error).error('Failed to update card settings')
    }
  }

  async replyMarkdownCard(messageId: string, markdown: string): Promise<string | undefined> {
    return this.replyCard(messageId, buildMarkdownCard(markdown))
  }

  async sendMarkdownCard(chatId: string, markdown: string): Promise<string | undefined> {
    return this.sendCard(chatId, buildMarkdownCard(markdown))
  }

  async fetchDocContent(docToken: string): Promise<string | null> {
    try {
      const resp = await this.sdk.docx.document.rawContent({
        path: { document_id: docToken },
      })
      return resp.data?.content ?? null
    } catch (error: unknown) {
      this.logger.withError(error as Error).error('Failed to fetch doc content')
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
      this.logger.withError(error as Error).error('Failed to append doc content')
      return false
    }
  }
}
