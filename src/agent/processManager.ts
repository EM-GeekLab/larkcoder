import { spawn, type ChildProcess } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Logger } from "../utils/logger"
import type { AgentProcessInfo } from "./types"

export type ProcessManagerOptions = {
  command: string
  args: string[]
  logger: Logger
}

export class ProcessManager {
  private processes = new Map<string, { process: ChildProcess }>()
  private command: string
  private args: string[]
  private logger: Logger
  private useMockAgent: boolean

  constructor(options: ProcessManagerOptions) {
    this.command = options.command
    this.args = options.args
    this.logger = options.logger
    this.useMockAgent = process.env.USE_MOCK_AGENT === "1" || process.env.USE_MOCK_AGENT === "true"

    if (this.useMockAgent) {
      this.logger.warn("⚠️  Using MOCK AGENT - This is for testing only (USE_MOCK_AGENT is set)")
    }
  }

  spawn(sessionId: string, workingDir: string): AgentProcessInfo {
    if (this.processes.has(sessionId)) {
      throw new Error(`Process already exists for session ${sessionId}`)
    }

    const command = this.useMockAgent ? this.getMockAgentCommand() : this.command
    const args = this.useMockAgent ? this.getMockAgentArgs() : this.args

    if (this.useMockAgent) {
      this.logger.warn(`⚠️  Spawning MOCK AGENT for session ${sessionId} (cwd ${workingDir})`)
    } else {
      this.logger.info(`Spawning agent: ${command} ${args.join(" ")} (cwd ${workingDir})`)
    }

    const child = spawn(command, args, {
      cwd: workingDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    })

    this.processes.set(sessionId, { process: child })

    child.stderr?.on("data", (data: Buffer) => {
      this.logger.debug(`[agent:${sessionId}:stderr] ${data.toString().trim()}`)
    })

    child.on("exit", (code, signal) => {
      this.logger.info(`Agent process exited: session=${sessionId} code=${code} signal=${signal}`)
      this.processes.delete(sessionId)
    })

    return {
      sessionId,
      process: child,
      pid: child.pid ?? 0,
      kill: () => {
        child.kill("SIGTERM")
      },
    }
  }

  kill(sessionId: string): void {
    const entry = this.processes.get(sessionId)
    if (!entry) {
      return
    }
    this.logger.info(`Killing agent process for session ${sessionId}`)
    entry.process.kill("SIGTERM")
    this.processes.delete(sessionId)
  }

  isAlive(sessionId: string): boolean {
    const entry = this.processes.get(sessionId)
    return entry !== undefined && entry.process.exitCode === null
  }

  getProcess(sessionId: string): ChildProcess | undefined {
    return this.processes.get(sessionId)?.process
  }

  killAll(): void {
    for (const [sessionId, entry] of this.processes) {
      this.logger.info(`Killing agent process for session ${sessionId}`)
      entry.process.kill("SIGTERM")
    }
    this.processes.clear()
  }

  private getMockAgentCommand(): string {
    // Use bun to run the TypeScript file directly
    return "bun"
  }

  private getMockAgentArgs(): string[] {
    // Get the path to mockAgent.ts relative to this file
    const currentFile = fileURLToPath(import.meta.url)
    const currentDir = dirname(currentFile)
    const mockAgentPath = join(currentDir, "mockAgent.ts")
    return [mockAgentPath]
  }
}
