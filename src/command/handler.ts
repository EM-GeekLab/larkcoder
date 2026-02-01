import type { LarkClient } from "../lark/client.js"
import type { ParsedMessage } from "../lark/types.js"
import type { Orchestrator } from "../orchestrator/orchestrator.js"
import type { SessionService } from "../session/service.js"
import type { Logger } from "../utils/logger.js"
import type { ParsedCommand } from "./parser.js"

const LOCAL_COMMANDS = new Set([
  "stop",
  "new",
  "clear",
  "list",
  "resume",
  "delete",
  "plan",
  "info",
  "model",
  "help",
])

const HELP_TEXT = `Available commands:
/help — Show this help message
/new [prompt] — Create a new session (with optional initial prompt)
/clear [prompt] — Alias for /new
/list — List recent sessions in this chat
/resume — Alias for /list
/delete — Delete a session
/stop — Stop the running agent
/plan — Toggle plan mode
/info — Show current session info
/model — Select model`

export class CommandHandler {
  constructor(
    private orchestrator: Orchestrator,
    private sessionService: SessionService,
    private larkClient: LarkClient,
    private logger: Logger,
  ) {}

  async handle(
    parsed: ParsedCommand,
    message: ParsedMessage,
    _threadId: string,
  ): Promise<void> {
    this.logger
      .withMetadata({ command: parsed.command, args: parsed.args })
      .info("Handling slash command")

    if (LOCAL_COMMANDS.has(parsed.command)) {
      await this.handleLocal(parsed, message)
    } else {
      await this.handlePassthrough(parsed, message)
    }
  }

  private async handleLocal(
    parsed: ParsedCommand,
    message: ParsedMessage,
  ): Promise<void> {
    switch (parsed.command) {
      case "help":
        await this.larkClient.replyMarkdownCard(message.messageId, HELP_TEXT)
        break

      case "stop":
        await this.handleStop(message)
        break

      case "new":
      case "clear":
        await this.handleNew(parsed.args, message)
        break

      case "list":
      case "resume":
        await this.handleList(message)
        break

      case "delete":
        await this.handleDelete(message)
        break

      case "plan":
        await this.handlePlan(message)
        break

      case "info":
        await this.handleInfo(message)
        break

      case "model":
        await this.handleModel(message)
        break
    }
  }

  private async handleStop(message: ParsedMessage): Promise<void> {
    const session = await this.orchestrator.resolveSession(message)
    if (!session) {
      await this.larkClient.replyMarkdownCard(
        message.messageId,
        "No active session found.",
      )
      return
    }
    await this.orchestrator.stopSession(session.id)
    await this.larkClient.replyMarkdownCard(
      message.messageId,
      "Session stopped.",
    )
  }

  private async handleNew(args: string, message: ParsedMessage): Promise<void> {
    if (args) {
      await this.orchestrator.handleNewSession(
        { ...message, text: args },
        message.messageId,
      )
    } else {
      await this.orchestrator.handleNewSession(message, message.messageId)
    }
  }

  private async handleList(message: ParsedMessage): Promise<void> {
    await this.orchestrator.handleListSessions(message)
  }

  private async handleDelete(message: ParsedMessage): Promise<void> {
    await this.orchestrator.handleDeleteSessions(message)
  }

  private async handlePlan(message: ParsedMessage): Promise<void> {
    const session = await this.orchestrator.resolveSession(message)
    if (!session) {
      await this.larkClient.replyMarkdownCard(
        message.messageId,
        "No active session found.",
      )
      return
    }
    const newMode = !session.isPlanMode
    await this.sessionService.setPlanMode(session.id, newMode)
    const label = newMode ? "Plan mode enabled" : "Plan mode disabled"
    await this.larkClient.replyMarkdownCard(message.messageId, label)
  }

  private async handleInfo(message: ParsedMessage): Promise<void> {
    const session = await this.orchestrator.resolveSession(message)
    if (!session) {
      await this.larkClient.replyMarkdownCard(
        message.messageId,
        "No session found.",
      )
      return
    }

    const lines = [
      `Session: ${session.id}`,
      `Status: ${session.status}`,
      `Prompt: ${session.initialPrompt.slice(0, 100)}`,
      `Plan mode: ${session.isPlanMode ? "on" : "off"}`,
      `Created: ${session.createdAt}`,
    ]

    await this.larkClient.replyMarkdownCard(message.messageId, lines.join("\n"))
  }

  private async handleModel(message: ParsedMessage): Promise<void> {
    const session = await this.orchestrator.resolveSession(message)
    if (!session) {
      await this.larkClient.replyMarkdownCard(
        message.messageId,
        "No active session found.",
      )
      return
    }
    await this.orchestrator.handleModelSelect(session.id, message)
  }

  private async handlePassthrough(
    parsed: ParsedCommand,
    message: ParsedMessage,
  ): Promise<void> {
    const session = await this.orchestrator.resolveSession(message)
    if (!session) {
      await this.larkClient.replyMarkdownCard(
        message.messageId,
        `Unknown command: /${parsed.command}`,
      )
      return
    }

    const active = this.orchestrator.getActiveSession(session.id)
    if (!active) {
      await this.larkClient.replyMarkdownCard(
        message.messageId,
        `Unknown command: /${parsed.command}`,
      )
      return
    }

    const available = this.orchestrator.getAvailableCommands(session.id)
    const commandText = `/${parsed.command}${parsed.args ? ` ${parsed.args}` : ""}`

    if (available.includes(parsed.command)) {
      if (session.status === "idle") {
        await this.orchestrator.runInSession(
          session.id,
          commandText,
          message.messageId,
        )
      } else if (session.status === "running") {
        await this.larkClient.replyMarkdownCard(
          message.messageId,
          "Agent is currently working. Please wait.",
        )
      }
    } else {
      await this.larkClient.replyMarkdownCard(
        message.messageId,
        `Unknown command: /${parsed.command}`,
      )
    }
  }
}
