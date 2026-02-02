import type { LarkClient } from "../lark/client.js"
import type { SessionService } from "../session/service.js"
import type { Logger } from "../utils/logger.js"
import {
  PROCESSING_ELEMENT_ID,
  buildStreamingCard,
  buildStreamingCloseSettings,
  buildStreamingMarkdownElement,
} from "../lark/cards/index.js"
import {
  STREAM_AUTO_CLOSE_MS,
  STREAM_FLUSH_INTERVAL_MS,
  STREAM_MAX_CONTENT_LENGTH,
  formatDuration,
  type ActiveSession,
  type ActiveSessionLookup,
  type SessionLockFn,
} from "./types.js"

export class StreamingCardManager {
  constructor(
    private larkClient: LarkClient,
    private sessionService: SessionService,
    private logger: Logger,
    private withSessionLock: SessionLockFn,
    private getActiveSession: ActiveSessionLookup,
  ) {}

  async createStreamingCard(
    active: ActiveSession,
    replyToMessageId: string | undefined,
    initialContent: string,
  ): Promise<void> {
    const cardId = await this.larkClient.createCardEntity(buildStreamingCard(initialContent))
    if (!cardId) {
      this.logger.error("Failed to create streaming card entity")
      return
    }

    let messageId: string | undefined
    if (replyToMessageId) {
      messageId = await this.larkClient.replyCardEntity(replyToMessageId, cardId)
    } else {
      const session = await this.sessionService.getSession(active.sessionId)
      messageId = await this.larkClient.sendCard(session.chatId, {
        type: "card",
        data: { card_id: cardId },
      })
    }

    if (!messageId) {
      this.logger.error("Failed to send streaming card")
      return
    }

    await this.sessionService.setWorkingMessageId(active.sessionId, messageId)

    active.cardSequences.set(cardId, 0)
    const now = Date.now()
    active.streamingCard = {
      cardId,
      messageId,
      activeElementId: "md_0",
      elementCounter: 0,
      accumulatedText: initialContent,
      lastFlushedText: initialContent,
      flushTimer: null,
      createdAt: now,
      streamingOpen: true,
      streamingOpenedAt: now,
      placeholderReplaced: initialContent.length > 0,
    }
  }

  scheduleFlush(active: ActiveSession): void {
    const card = active.streamingCard
    if (!card || card.flushTimer) {
      return
    }

    if (card.accumulatedText === card.lastFlushedText) {
      return
    }

    const sessionId = active.sessionId
    card.flushTimer = setTimeout(() => {
      card.flushTimer = null
      const current = this.getActiveSession(sessionId)
      if (current) {
        void this.withSessionLock(sessionId, () => this.flushStreamingCard(current))
      }
    }, STREAM_FLUSH_INTERVAL_MS)
  }

  async forceFlush(active: ActiveSession): Promise<void> {
    const card = active.streamingCard
    if (!card) {
      return
    }

    if (card.flushTimer) {
      clearTimeout(card.flushTimer)
      card.flushTimer = null
    }

    await this.flushStreamingCard(active)
  }

  async closeStreamingCard(active: ActiveSession, summaryText: string): Promise<void> {
    await this.forceFlush(active)

    const card = active.streamingCard
    if (!card) {
      return
    }

    const elapsed = formatDuration(Date.now() - card.createdAt)
    const seq = this.nextSequence(active)
    await this.larkClient.updateCardElement(
      card.cardId,
      PROCESSING_ELEMENT_ID,
      {
        tag: "markdown",
        content: `<font color='grey'>${elapsed}</font>`,
        text_size: "notation",
        element_id: PROCESSING_ELEMENT_ID,
        icon: {
          tag: "standard_icon",
          token: "done_outlined",
          color: "grey",
        },
      },
      seq,
    )

    const closeSettings = buildStreamingCloseSettings(summaryText)
    const finalSeq = this.nextSequence(active)
    await this.larkClient.updateCardSettings(card.cardId, closeSettings, finalSeq)

    await this.sessionService.setWorkingMessageId(active.sessionId, null)
    active.streamingCard = undefined
  }

  async ensureStreamingCard(active: ActiveSession): Promise<void> {
    if (active.streamingCard) {
      return
    }
    if (active.streamingCardPending) {
      await active.streamingCardPending
      return
    }
    active.streamingCardPending = this.createStreamingCard(active, undefined, "")
    try {
      await active.streamingCardPending
    } finally {
      active.streamingCardPending = undefined
    }
  }

  async ensureStreamingOpen(active: ActiveSession): Promise<void> {
    const card = active.streamingCard
    if (!card) {
      return
    }

    const elapsed = Date.now() - card.streamingOpenedAt
    if (card.streamingOpen && elapsed < STREAM_AUTO_CLOSE_MS) {
      return
    }

    const seq = this.nextSequence(active)
    await this.larkClient.updateCardSettings(
      card.cardId,
      {
        config: {
          streaming_mode: true,
          summary: { content: "[生成中...]" },
        },
      },
      seq,
    )

    card.streamingOpen = true
    card.streamingOpenedAt = Date.now()
  }

  async ensureActiveElement(active: ActiveSession): Promise<string | null> {
    const card = active.streamingCard
    if (!card) {
      return null
    }
    if (card.activeElementId) {
      return card.activeElementId
    }

    const newId = this.nextElementId(active, "md")
    await this.insertElement(active, buildStreamingMarkdownElement(newId))
    card.activeElementId = newId
    return newId
  }

  async insertElement(active: ActiveSession, element: Record<string, unknown>): Promise<void> {
    const card = active.streamingCard
    if (!card) {
      return
    }
    const seq = this.nextSequence(active)
    await this.larkClient.addCardElements(
      card.cardId,
      "insert_before",
      PROCESSING_ELEMENT_ID,
      [element],
      seq,
    )
  }

  nextElementId(active: ActiveSession, prefix: string): string {
    const card = active.streamingCard
    if (!card) {
      return `${prefix}_0`
    }
    card.elementCounter++
    return `${prefix}_${card.elementCounter}`
  }

  nextSequence(active: ActiveSession): number {
    const cardId = active.streamingCard?.cardId
    if (!cardId) {
      return 0
    }
    return this.nextSequenceForCard(active, cardId)
  }

  nextSequenceForCard(active: ActiveSession, cardId: string): number {
    const seq = (active.cardSequences.get(cardId) ?? 0) + 1
    active.cardSequences.set(cardId, seq)
    return seq
  }

  async pauseStreamingForInteraction(
    sessionId: string,
    defaultSummary: string = "(等待操作)",
  ): Promise<string | null> {
    return this.withSessionLock(sessionId, async () => {
      const active = this.getActiveSession(sessionId)
      if (!active?.streamingCard) {
        return null
      }

      const summaryText = active.streamingCard.accumulatedText.slice(0, 100)
      const summary = summaryText.length > 0 ? `${summaryText}...` : defaultSummary

      await this.closeStreamingCard(active, summary)
      return summary
    })
  }

  private async flushStreamingCard(active: ActiveSession): Promise<void> {
    const card = active.streamingCard
    if (!card || card.accumulatedText === card.lastFlushedText) {
      return
    }

    await this.ensureStreamingOpen(active)

    const elementId = await this.ensureActiveElement(active)
    if (!elementId) {
      return
    }

    const content = card.accumulatedText.slice(0, STREAM_MAX_CONTENT_LENGTH)
    const seq = this.nextSequence(active)

    if (!card.placeholderReplaced) {
      await this.larkClient.updateCardElement(
        card.cardId,
        "md_0",
        { tag: "markdown", content, element_id: "md_0" },
        seq,
      )
      card.placeholderReplaced = true
    } else {
      await this.larkClient.streamCardText(card.cardId, elementId, content, seq)
    }

    card.lastFlushedText = card.accumulatedText
  }
}
