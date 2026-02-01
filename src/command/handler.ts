import type { LarkClient } from "../lark/client.js"
import type { ParsedMessage } from "../lark/types.js"
import type { Orchestrator } from "../orchestrator/orchestrator.js"
import type { TaskService } from "../task/service.js"
import type { Logger } from "../utils/logger.js"
import type { ParsedCommand } from "./parser.js"
import { extractErrorMessage } from "../utils/errors.js"

const LOCAL_COMMANDS = new Set([
  "stop",
  "done",
  "retry",
  "new",
  "status",
  "list",
  "help",
])

const ACP_COMMANDS = new Set(["mode", "model"])

const HELP_TEXT = `Available commands:
/stop — Cancel the running task
/done — Mark the current task as complete
/retry [prompt] — Retry the failed task (optionally with a new prompt)
/new <prompt> — Create a new task in this thread
/status — Show current task status
/list — List recent tasks in this chat
/help — Show this help message
/mode <name> — Switch session mode (ask/code/plan)
/model <name> — Switch model`

export class CommandHandler {
  constructor(
    private orchestrator: Orchestrator,
    private taskService: TaskService,
    private larkClient: LarkClient,
    private logger: Logger,
  ) {}

  async handle(
    parsed: ParsedCommand,
    message: ParsedMessage,
    threadId: string,
  ): Promise<void> {
    this.logger
      .withMetadata({ command: parsed.command, args: parsed.args })
      .info("Handling slash command")

    if (LOCAL_COMMANDS.has(parsed.command)) {
      await this.handleLocal(parsed, message, threadId)
    } else if (ACP_COMMANDS.has(parsed.command)) {
      await this.handleAcp(parsed, message, threadId)
    } else {
      await this.handlePassthrough(parsed, message, threadId)
    }
  }

  private async handleLocal(
    parsed: ParsedCommand,
    message: ParsedMessage,
    threadId: string,
  ): Promise<void> {
    switch (parsed.command) {
      case "help":
        await this.larkClient.replyText(message.messageId, HELP_TEXT)
        break

      case "stop":
        await this.handleStop(message, threadId)
        break

      case "done":
        await this.handleDone(message, threadId)
        break

      case "retry":
        await this.handleRetry(parsed.args, message, threadId)
        break

      case "new":
        await this.handleNew(parsed.args, message, threadId)
        break

      case "status":
        await this.handleStatus(message, threadId)
        break

      case "list":
        await this.handleList(message)
        break
    }
  }

  private async handleStop(
    message: ParsedMessage,
    threadId: string,
  ): Promise<void> {
    const task = await this.taskService.getTaskByThread(threadId)
    if (!task || task.status === "completed" || task.status === "cancelled") {
      await this.larkClient.replyText(
        message.messageId,
        "No active task in this thread.",
      )
      return
    }
    await this.orchestrator.stopTask(task.id)
  }

  private async handleDone(
    message: ParsedMessage,
    threadId: string,
  ): Promise<void> {
    const task = await this.taskService.getTaskByThread(threadId)
    if (!task || task.status === "completed" || task.status === "cancelled") {
      await this.larkClient.replyText(
        message.messageId,
        "No active task in this thread.",
      )
      return
    }
    await this.orchestrator.markComplete(task.id)
  }

  private async handleRetry(
    args: string,
    message: ParsedMessage,
    threadId: string,
  ): Promise<void> {
    const task = await this.taskService.getTaskByThread(threadId)
    if (!task) {
      await this.larkClient.replyText(
        message.messageId,
        "No task found in this thread.",
      )
      return
    }
    if (task.status !== "failed" && task.status !== "waiting") {
      await this.larkClient.replyText(
        message.messageId,
        `Cannot retry task in ${task.status} state.`,
      )
      return
    }
    await this.orchestrator.retryTask(task.id, args || undefined)
  }

  private async handleNew(
    args: string,
    message: ParsedMessage,
    threadId: string,
  ): Promise<void> {
    if (!args) {
      await this.larkClient.replyText(message.messageId, "Usage: /new <prompt>")
      return
    }
    await this.orchestrator.handleNewTask({ ...message, text: args }, threadId)
  }

  private async handleStatus(
    message: ParsedMessage,
    threadId: string,
  ): Promise<void> {
    const task = await this.taskService.getTaskByThread(threadId)
    if (!task) {
      await this.larkClient.replyText(
        message.messageId,
        "No task found in this thread.",
      )
      return
    }

    const lines = [
      `Task: ${task.id}`,
      `Status: ${task.status}`,
      `Prompt: ${task.prompt.slice(0, 100)}`,
    ]
    if (task.summary) {
      lines.push(`Summary: ${task.summary.slice(0, 200)}`)
    }
    if (task.errorMessage) {
      lines.push(`Error: ${task.errorMessage.slice(0, 200)}`)
    }
    lines.push(`Created: ${task.createdAt}`)

    await this.larkClient.replyText(message.messageId, lines.join("\n"))
  }

  private async handleList(message: ParsedMessage): Promise<void> {
    const tasks = await this.taskService.getTasksByChatId(message.chatId)
    if (tasks.length === 0) {
      await this.larkClient.replyText(
        message.messageId,
        "No tasks found in this chat.",
      )
      return
    }

    const lines = tasks.slice(0, 10).map((t) => {
      const prompt =
        t.prompt.length > 50 ? `${t.prompt.slice(0, 50)}...` : t.prompt
      return `[${t.status}] ${prompt} (${t.createdAt})`
    })

    await this.larkClient.replyText(message.messageId, lines.join("\n"))
  }

  private async handleAcp(
    parsed: ParsedCommand,
    message: ParsedMessage,
    threadId: string,
  ): Promise<void> {
    const task = await this.taskService.getTaskByThread(threadId)
    if (!task || task.status !== "running") {
      await this.larkClient.replyText(
        message.messageId,
        "No running task in this thread.",
      )
      return
    }

    const session = this.orchestrator.getActiveSession(task.id)
    if (!session) {
      await this.larkClient.replyText(
        message.messageId,
        "No active session for this task.",
      )
      return
    }

    switch (parsed.command) {
      case "mode": {
        if (!parsed.args) {
          await this.larkClient.replyText(
            message.messageId,
            "Usage: /mode <ask|code|plan>",
          )
          return
        }
        try {
          await session.client.setSessionMode({
            sessionId: session.sessionId,
            modeId: parsed.args,
          })
          await this.larkClient.replyText(
            message.messageId,
            `Mode switched to: ${parsed.args}`,
          )
        } catch (error: unknown) {
          const msg = extractErrorMessage(error)
          await this.larkClient.replyText(
            message.messageId,
            `Failed to switch mode: ${msg}`,
          )
        }
        break
      }

      case "model": {
        if (!parsed.args) {
          await this.larkClient.replyText(
            message.messageId,
            "Usage: /model <model-name>",
          )
          return
        }
        // unstable_setSessionModel is not yet exposed in our AgentClient interface,
        // so forward as a prompt for now
        await this.larkClient.replyText(
          message.messageId,
          "Model switching is not yet supported.",
        )
        break
      }
    }
  }

  private async handlePassthrough(
    parsed: ParsedCommand,
    message: ParsedMessage,
    threadId: string,
  ): Promise<void> {
    const task = await this.taskService.getTaskByThread(threadId)
    if (!task) {
      await this.larkClient.replyText(
        message.messageId,
        `Unknown command: /${parsed.command}`,
      )
      return
    }

    // Check if the command is in the agent's available commands
    const available = this.orchestrator.getAvailableCommands(task.id)
    const commandText = `/${parsed.command}${parsed.args ? ` ${parsed.args}` : ""}`

    if (available.includes(parsed.command)) {
      // Forward as a prompt to the agent
      if (task.status === "waiting") {
        await this.orchestrator.continueTask(task.id, commandText)
      } else if (task.status === "running") {
        await this.larkClient.replyText(
          message.messageId,
          "Agent is currently working. Please wait for it to finish.",
        )
      } else {
        await this.larkClient.replyText(
          message.messageId,
          `Cannot send command in ${task.status} state.`,
        )
      }
    } else {
      await this.larkClient.replyText(
        message.messageId,
        `Unknown command: /${parsed.command}`,
      )
    }
  }
}
