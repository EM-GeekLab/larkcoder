import type { LarkClient } from "../lark/client"
import type { ParsedMessage } from "../lark/types"
import type { Orchestrator } from "../orchestrator/orchestrator"
import type { SessionService } from "../session/service"
import type { Session } from "../session/types"
import type { Logger } from "../utils/logger"
import type { ParsedCommand } from "./parser"
import type { ShellCommandHandler } from "./shellCommandHandler"
import { buildPlanCard } from "../lark/cards/index"
import { isPromptCommand, resolvePromptCommand, generatePromptCommandHelp } from "./promptCommands"

const LOCAL_COMMANDS = new Set([
  "stop",
  "kill",
  "new",
  "clear",
  "list",
  "listall",
  "resume",
  "delete",
  "todo",
  "plan",
  "solo",
  "yolo",
  "mode",
  "info",
  "model",
  "config",
  "command",
  "project",
  "help",
])

const HELP_TEXT = `Available commands:
/help — Show this help message
! <command> — Execute shell command in session's working directory
/new [prompt] — Create a new session (with optional initial prompt)
/clear [prompt] — Alias for /new
/list — List sessions (scoped to current project)
/listall — List all sessions in this chat
/resume — Alias for /list
/delete — Delete a session
/stop — Stop the running agent
/kill — Kill running shell command
/todo — Show current task checklist
/plan — Alias for /todo
/solo — Toggle solo mode (bypass all permissions)
/mode [name] — Show or switch mode (use /mode to see available modes)
/info — Show current session info
/model — Select model
/command — Show agent commands
/config — Show and change config options
/project — Show project subcommands
/project new — Create a new project
/project list — List and switch projects
/project info — Show current project info
/project edit — Edit current project
/project exit — Exit current project (back to root)
${generatePromptCommandHelp()}`

export class CommandHandler {
  constructor(
    private orchestrator: Orchestrator,
    private sessionService: SessionService,
    private larkClient: LarkClient,
    private logger: Logger,
    private shellCommandHandler: ShellCommandHandler,
  ) {}

  private async requireSession(message: ParsedMessage): Promise<Session | null> {
    const session = await this.orchestrator.resolveSession(message)
    if (!session) {
      await this.larkClient.replyMarkdownCard(message.messageId, "No active session found.")
    }
    return session
  }

  private async replyBusy(message: ParsedMessage): Promise<void> {
    await this.larkClient.replyMarkdownCard(
      message.messageId,
      "Agent is currently working. Please wait.",
    )
  }

  async handle(parsed: ParsedCommand, message: ParsedMessage, _threadId: string): Promise<void> {
    // Route shell commands
    if (parsed.type === "shell") {
      await this.shellCommandHandler.execute(parsed.args, message)
      return
    }

    this.logger
      .withMetadata({ command: parsed.command, args: parsed.args })
      .info("Handling slash command")

    if (LOCAL_COMMANDS.has(parsed.command)) {
      await this.handleLocal(parsed, message)
    } else if (isPromptCommand(parsed.command)) {
      await this.handlePromptCommand(parsed, message)
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

      case "kill":
        await this.handleKill(message)
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

      case "todo":
      case "plan":
        await this.handleTodo(message)
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

      case "command":
        await this.handleCommand(message)
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
    const session = await this.requireSession(message)
    if (!session) {
      return
    }

    await this.orchestrator.stopSession(session.id)
    await this.larkClient.replyMarkdownCard(message.messageId, "Session stopped.")
  }

  private async handleKill(message: ParsedMessage): Promise<void> {
    const session = await this.requireSession(message)
    if (!session) {
      return
    }

    const active = this.orchestrator.getActiveSession(session.id)
    if (!active?.shellProcess) {
      await this.larkClient.replyMarkdownCard(message.messageId, "No running shell command found.")
      return
    }

    this.logger.info(`Killing shell process for session ${session.id}`)
    active.shellProcess.kill()
    await this.larkClient.replyMarkdownCard(message.messageId, "Shell command terminated.")
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

  private async handleTodo(message: ParsedMessage): Promise<void> {
    const session = await this.requireSession(message)
    if (!session) {
      return
    }

    const currentPlan = this.orchestrator.getCurrentPlan(session.id)
    if (currentPlan && currentPlan.length > 0) {
      await this.larkClient.replyCard(message.messageId, buildPlanCard(currentPlan))
      return
    }

    await this.larkClient.replyMarkdownCard(message.messageId, "No plan available.")
  }

  private async handleSolo(message: ParsedMessage): Promise<void> {
    const session = await this.requireSession(message)
    if (!session) {
      return
    }
    const currentMode = this.orchestrator.getCurrentMode(session.id) ?? session.mode
    const newMode = currentMode === "bypassPermissions" ? "default" : "bypassPermissions"
    await this.switchMode(session.id, newMode, message.messageId)
  }

  private async handleMode(args: string, message: ParsedMessage): Promise<void> {
    const session = await this.requireSession(message)
    if (!session) {
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
    const session = await this.requireSession(message)
    if (!session) {
      return
    }

    // Ensure ActiveSession is initialized to get complete session info including model
    await this.orchestrator.ensureAgentSession(session)

    const modes = this.orchestrator.getAvailableModes(session.id)
    const currentMode = modes.find((m) => m.id === session.mode)
    const modeDisplay = currentMode?.name ?? session.mode
    const modeWithDesc = currentMode?.description
      ? `${modeDisplay} <font color='grey'>${currentMode.description}</font>`
      : modeDisplay

    const currentModelId = this.orchestrator.getCurrentModel(session.id)
    const availableModels = this.orchestrator.getAvailableModels(session.id)
    const currentModel = currentModelId
      ? availableModels.find((m) => m.modelId === currentModelId)
      : undefined
    const modelDisplay = currentModel?.name ?? currentModelId ?? "N/A"
    const modelWithDesc = currentModel?.description
      ? `${modelDisplay} <font color='grey'>${currentModel.description}</font>`
      : modelDisplay

    const projectName = session.projectId
      ? await this.orchestrator.getProjectName(session.projectId)
      : undefined

    const lines = [
      `Session: ${session.id}`,
      `Status: ${session.status}`,
      `Prompt: ${session.initialPrompt.slice(0, 100)}`,
      `Mode: ${modeWithDesc}`,
      `Model: ${modelWithDesc}`,
      `Created: ${session.createdAt}`,
    ]
    if (projectName) {
      lines.push(`Project: ${projectName}`)
    }

    await this.larkClient.replyMarkdownCard(message.messageId, lines.join("\n"))
  }

  private async handleModel(message: ParsedMessage): Promise<void> {
    const session = await this.requireSession(message)
    if (!session) {
      return
    }
    await this.orchestrator.handleModelSelect(session.id, message)
  }

  private async handleCommand(message: ParsedMessage): Promise<void> {
    const session = await this.requireSession(message)
    if (!session) {
      return
    }
    await this.orchestrator.handleCommandSelect(session.id, message)
  }

  private async handleConfig(message: ParsedMessage): Promise<void> {
    const session = await this.requireSession(message)
    if (!session) {
      return
    }
    await this.orchestrator.handleConfigSelect(session.id, message)
  }

  private readonly projectSubcommands = new Map<string, (message: ParsedMessage) => Promise<void>>([
    ["new", (message) => this.orchestrator.handleProjectCreate(message)],
    ["list", (message) => this.orchestrator.handleListProjects(message)],
    ["info", (message) => this.orchestrator.handleProjectInfo(message)],
    ["edit", (message) => this.orchestrator.handleProjectEdit(message)],
    ["exit", (message) => this.orchestrator.handleProjectExit(message)],
    ["root", (message) => this.orchestrator.handleProjectExit(message)],
  ])

  private async handleProject(args: string, message: ParsedMessage): Promise<void> {
    const sub = args.trim().toLowerCase()
    const handler = this.projectSubcommands.get(sub)
    if (handler) {
      await handler(message)
      return
    }
    await this.larkClient.replyMarkdownCard(
      message.messageId,
      "/project new — Create a new project\n/project list — List and switch projects\n/project info — Show current project info\n/project edit — Edit current project\n/project exit — Exit current project",
    )
  }

  private async handlePromptCommand(parsed: ParsedCommand, message: ParsedMessage): Promise<void> {
    const result = resolvePromptCommand(parsed.command, parsed.args)
    if (!result) {
      return
    }

    if (result.type === "help") {
      await this.larkClient.replyMarkdownCard(message.messageId, result.help)
      return
    }

    const session = await this.requireSession(message)
    if (!session) {
      return
    }

    if (session.status === "running") {
      await this.replyBusy(message)
      return
    }

    await this.orchestrator.runInSession(session.id, result.prompt, message.messageId)
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

    if (available.some((c) => c.name === parsed.command)) {
      if (session.status === "idle") {
        await this.orchestrator.runInSession(session.id, commandText, message.messageId)
      } else if (session.status === "running") {
        await this.replyBusy(message)
      }
    } else {
      await this.larkClient.replyMarkdownCard(
        message.messageId,
        `Unknown command: /${parsed.command}`,
      )
    }
  }
}
