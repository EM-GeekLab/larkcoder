import type { LarkClient } from "../lark/client"
import type { ParsedMessage } from "../lark/types"
import type { Orchestrator } from "../orchestrator/orchestrator"
import type { SessionService } from "../session/service"
import type { Logger } from "../utils/logger"
import type { ParsedCommand } from "./parser"

const LOCAL_COMMANDS = new Set([
  "stop",
  "new",
  "clear",
  "list",
  "listall",
  "resume",
  "delete",
  "plan",
  "solo",
  "yolo",
  "mode",
  "info",
  "model",
  "config",
  "project",
  "help",
])

const HELP_TEXT = `Available commands:
/help — Show this help message
/new [prompt] — Create a new session (with optional initial prompt)
/clear [prompt] — Alias for /new
/list — List sessions (scoped to current project)
/listall — List all sessions in this chat
/resume — Alias for /list
/delete — Delete a session
/stop — Stop the running agent
/plan — Toggle plan mode
/solo — Toggle solo mode (bypass all permissions)
/mode [name] — Show or switch mode (use /mode to see available modes)
/info — Show current session info
/model — Select model
/config — Show and change config options
/project — Show project subcommands
/project new — Create a new project
/project list — List and switch projects
/project info — Show current project info
/project edit — Edit current project
/project exit — Exit current project (back to root)`

export class CommandHandler {
  constructor(
    private orchestrator: Orchestrator,
    private sessionService: SessionService,
    private larkClient: LarkClient,
    private logger: Logger,
  ) {}

  async handle(parsed: ParsedCommand, message: ParsedMessage, _threadId: string): Promise<void> {
    this.logger
      .withMetadata({ command: parsed.command, args: parsed.args })
      .info("Handling slash command")

    if (LOCAL_COMMANDS.has(parsed.command)) {
      await this.handleLocal(parsed, message)
    } else {
      await this.handlePassthrough(parsed, message)
    }
  }

  private async handleLocal(parsed: ParsedCommand, message: ParsedMessage): Promise<void> {
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

      case "listall":
        await this.handleListAll(message)
        break

      case "delete":
        await this.handleDelete(message)
        break

      case "plan":
        await this.handlePlan(message)
        break

      case "solo":
      case "yolo":
        await this.handleSolo(message)
        break

      case "mode":
        await this.handleMode(parsed.args, message)
        break

      case "info":
        await this.handleInfo(message)
        break

      case "model":
        await this.handleModel(message)
        break

      case "config":
        await this.handleConfig(message)
        break

      case "project":
        await this.handleProject(parsed.args, message)
        break
    }
  }

  private async handleStop(message: ParsedMessage): Promise<void> {
    const session = await this.orchestrator.resolveSession(message)
    if (!session) {
      await this.larkClient.replyMarkdownCard(message.messageId, "No active session found.")
      return
    }
    await this.orchestrator.stopSession(session.id)
    await this.larkClient.replyMarkdownCard(message.messageId, "Session stopped.")
  }

  private async handleNew(args: string, message: ParsedMessage): Promise<void> {
    await this.orchestrator.handleNewSession({ ...message, text: args }, message.messageId)
  }

  private async handleList(message: ParsedMessage): Promise<void> {
    await this.orchestrator.handleListSessions(message)
  }

  private async handleListAll(message: ParsedMessage): Promise<void> {
    await this.orchestrator.handleListSessions(message, true)
  }

  private async handleDelete(message: ParsedMessage): Promise<void> {
    await this.orchestrator.handleDeleteSessions(message)
  }

  private async handlePlan(message: ParsedMessage): Promise<void> {
    const session = await this.orchestrator.resolveSession(message)
    if (!session) {
      await this.larkClient.replyMarkdownCard(message.messageId, "No active session found.")
      return
    }
    const currentMode = this.orchestrator.getCurrentMode(session.id) ?? session.mode
    const newMode = currentMode === "plan" ? "default" : "plan"
    await this.switchMode(session.id, newMode, message.messageId)
  }

  private async handleSolo(message: ParsedMessage): Promise<void> {
    const session = await this.orchestrator.resolveSession(message)
    if (!session) {
      await this.larkClient.replyMarkdownCard(message.messageId, "No active session found.")
      return
    }
    const currentMode = this.orchestrator.getCurrentMode(session.id) ?? session.mode
    const newMode = currentMode === "bypassPermissions" ? "default" : "bypassPermissions"
    await this.switchMode(session.id, newMode, message.messageId)
  }

  private async handleMode(args: string, message: ParsedMessage): Promise<void> {
    const session = await this.orchestrator.resolveSession(message)
    if (!session) {
      await this.larkClient.replyMarkdownCard(message.messageId, "No active session found.")
      return
    }
    if (!args) {
      await this.orchestrator.handleModeSelect(session.id, message)
      return
    }
    const modes = this.orchestrator.getAvailableModes(session.id)
    const matched = modes.find((m) => m.id === args || m.name.toLowerCase() === args.toLowerCase())
    if (!matched) {
      const available = modes.map((m) => m.id).join(", ")
      const hint = available
        ? `Available: ${available}`
        : "No modes available. Send a message first to initialize the session."
      await this.larkClient.replyMarkdownCard(message.messageId, `Unknown mode: ${args}\n${hint}`)
      return
    }
    await this.switchMode(session.id, matched.id, message.messageId)
  }

  private async switchMode(sessionId: string, modeId: string, replyTo: string): Promise<void> {
    await this.sessionService.setMode(sessionId, modeId)
    await this.orchestrator.setSessionMode(sessionId, modeId)
    const modes = this.orchestrator.getAvailableModes(sessionId)
    const display = modes.find((m) => m.id === modeId)?.name ?? modeId
    await this.larkClient.replyMarkdownCard(replyTo, `Mode: ${display}`)
  }

  private async handleInfo(message: ParsedMessage): Promise<void> {
    const session = await this.orchestrator.resolveSession(message)
    if (!session) {
      await this.larkClient.replyMarkdownCard(message.messageId, "No session found.")
      return
    }

    const modes = this.orchestrator.getAvailableModes(session.id)
    const modeDisplay = modes.find((m) => m.id === session.mode)?.name ?? session.mode

    const projectName = session.projectId
      ? await this.orchestrator.getProjectName(session.projectId)
      : undefined

    const lines = [
      `Session: ${session.id}`,
      `Status: ${session.status}`,
      `Prompt: ${session.initialPrompt.slice(0, 100)}`,
      `Mode: ${modeDisplay}`,
      `Created: ${session.createdAt}`,
    ]
    if (projectName) {
      lines.push(`Project: ${projectName}`)
    }

    await this.larkClient.replyMarkdownCard(message.messageId, lines.join("\n"))
  }

  private async handleModel(message: ParsedMessage): Promise<void> {
    const session = await this.orchestrator.resolveSession(message)
    if (!session) {
      await this.larkClient.replyMarkdownCard(message.messageId, "No active session found.")
      return
    }
    await this.orchestrator.handleModelSelect(session.id, message)
  }

  private async handleConfig(message: ParsedMessage): Promise<void> {
    const session = await this.orchestrator.resolveSession(message)
    if (!session) {
      await this.larkClient.replyMarkdownCard(message.messageId, "No active session found.")
      return
    }
    await this.orchestrator.handleConfigSelect(session.id, message)
  }

  private async handleProject(args: string, message: ParsedMessage): Promise<void> {
    const sub = args.trim().toLowerCase()
    if (sub === "new") {
      await this.orchestrator.handleProjectCreate(message)
    } else if (sub === "list") {
      await this.orchestrator.handleListProjects(message)
    } else if (sub === "info") {
      await this.orchestrator.handleProjectInfo(message)
    } else if (sub === "edit") {
      await this.orchestrator.handleProjectEdit(message)
    } else if (sub === "exit" || sub === "root") {
      await this.orchestrator.handleProjectExit(message)
    } else {
      await this.larkClient.replyMarkdownCard(
        message.messageId,
        "/project new — Create a new project\n/project list — List and switch projects\n/project info — Show current project info\n/project edit — Edit current project\n/project exit — Exit current project",
      )
    }
  }

  private async handlePassthrough(parsed: ParsedCommand, message: ParsedMessage): Promise<void> {
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
        await this.orchestrator.runInSession(session.id, commandText, message.messageId)
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
