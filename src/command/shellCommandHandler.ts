import type { LarkClient } from "../lark/client"
import type { ParsedMessage } from "../lark/types"
import type { Orchestrator } from "../orchestrator/orchestrator"
import type { StreamingCardManager } from "../orchestrator/streamingCardManager"
import type { SessionService } from "../session/service"
import type { Logger } from "../utils/logger"
import type { ShellExecutor } from "./shellExecutor"
import { PROCESSING_ELEMENT_ID, buildStreamingCloseSettings } from "../lark/cards/streaming"
import { formatDuration } from "../orchestrator/types"

const DEFAULT_TIMEOUT = 5 * 60 * 1000 // 5 minutes
const MAX_OUTPUT_LENGTH = 100_000 // 100KB

export class ShellCommandHandler {
  constructor(
    private orchestrator: Orchestrator,
    private sessionService: SessionService,
    private larkClient: LarkClient,
    private shellExecutor: ShellExecutor,
    private streamingCardManager: StreamingCardManager,
    private logger: Logger,
    private timeout: number = DEFAULT_TIMEOUT,
  ) {}

  async execute(command: string, message: ParsedMessage): Promise<void> {
    // Resolve session
    const session = await this.orchestrator.resolveSession(message)
    if (!session) {
      // Offer to create new session
      await this.larkClient.replyMarkdownCard(
        message.messageId,
        "No active session. Use /new to create one first.",
      )
      return
    }

    // Ensure ActiveSession exists for streaming
    await this.orchestrator.ensureAgentSession(session)
    const active = this.orchestrator.getActiveSession(session.id)
    if (!active) {
      throw new Error(`Failed to initialize session ${session.id}`)
    }

    // Create streaming card with output code block (no command echo)
    await this.streamingCardManager.createStreamingCard(
      active,
      message.messageId,
      "```\n", // Start output code block directly
    )

    // Track start time for duration display
    const startTime = Date.now()

    this.logger.withMetadata({ sessionId: session.id, command }).info("Executing shell command")

    let outputLength = 0
    let truncated = false

    // Execute command with streaming
    const shellProcess = this.shellExecutor.execute(
      command,
      session.workingDir,
      this.timeout,

      // stdout handler
      (data: string) => {
        if (truncated) {
          return
        }
        // Strip ANSI codes
        const cleanData = Bun.stripANSI(data)
        outputLength += cleanData.length

        if (outputLength > MAX_OUTPUT_LENGTH) {
          const remaining = MAX_OUTPUT_LENGTH - (outputLength - cleanData.length)
          if (remaining > 0) {
            active.streamingCard!.accumulatedText += cleanData.slice(0, remaining)
          }
          active.streamingCard!.accumulatedText += "\n[Output truncated at 100KB]"
          truncated = true
        } else {
          active.streamingCard!.accumulatedText += cleanData
        }

        this.streamingCardManager.scheduleFlush(active)
      },

      // stderr handler
      (data: string) => {
        if (truncated) {
          return
        }
        // Strip ANSI codes
        const cleanData = Bun.stripANSI(data)
        outputLength += cleanData.length

        if (outputLength > MAX_OUTPUT_LENGTH) {
          truncated = true
          return
        }

        // No special formatting - stderr goes into same code block
        active.streamingCard!.accumulatedText += cleanData
        this.streamingCardManager.scheduleFlush(active)
      },

      // exit handler
      async (code, signal) => {
        // Clean up shell process reference
        if (active.shellProcess) {
          active.shellProcess = undefined
        }

        // Calculate duration
        const duration = formatDuration(Date.now() - startTime)

        // Close code block
        active.streamingCard!.accumulatedText += "\n```"
        await this.streamingCardManager.forceFlush(active)

        // Update footer with execution status (duration + exit code/signal)
        const seq = this.streamingCardManager.nextSequence(active)
        let statusIcon: { token: string; color: string }
        let statusText: string

        if (signal) {
          // Terminated by signal (orange warning icon)
          statusIcon = { token: "warn-report_outlined", color: "orange" }
          statusText = `${duration} · Signal: ${signal}`
        } else if (code === 0) {
          // Success (green checkmark)
          statusIcon = { token: "done_outlined", color: "green" }
          statusText = `${duration} · Exit: ${code}`
        } else {
          // Failure (red X)
          statusIcon = { token: "more-close_outlined", color: "red" }
          statusText = `${duration} · Exit: ${code}`
        }

        await this.larkClient.updateCardElement(
          active.streamingCard!.cardId,
          PROCESSING_ELEMENT_ID,
          {
            tag: "markdown",
            content: `<font color='grey'>${statusText}</font>`,
            text_size: "notation",
            element_id: PROCESSING_ELEMENT_ID,
            icon: {
              tag: "standard_icon",
              token: statusIcon.token,
              color: statusIcon.color,
            },
          },
          seq,
        )

        // Close streaming card (without overwriting footer)
        const summary = signal
          ? `Terminated (${signal})`
          : code === 0
            ? "Completed successfully"
            : `Failed (exit ${code})`

        const closeSettings = buildStreamingCloseSettings(summary)
        const finalSeq = this.streamingCardManager.nextSequence(active)
        await this.larkClient.updateCardSettings(
          active.streamingCard!.cardId,
          closeSettings,
          finalSeq,
        )

        await this.sessionService.setWorkingMessageId(active.sessionId, null)
        active.streamingCard = undefined

        this.logger
          .withMetadata({ sessionId: session.id, code, signal, outputLength })
          .info("Shell command completed")
      },
    )

    // CRITICAL: Store process reference for /stop support
    active.shellProcess = shellProcess
  }
}
