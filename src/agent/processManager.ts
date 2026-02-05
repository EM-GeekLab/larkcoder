import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { Logger } from "../utils/logger"
import type { AgentProcessInfo } from "./types"

export type ProcessManagerOptions = {
  command: string
  args?: string[]
  logger: Logger
}

export class ProcessManager {
  private processes = new Map<string, { process: ChildProcess }>()
  private command: string
  private args: string[]
  private logger: Logger
  private useMockAgent: boolean

  constructor(options: ProcessManagerOptions) {
    this.logger = options.logger
    this.useMockAgent = process.env.USE_MOCK_AGENT === "1" || process.env.USE_MOCK_AGENT === "true"

    if (this.useMockAgent) {
      this.command = "bun"
      this.args = [this.getMockAgentPath()]
      this.logger.warn("⚠️  Using MOCK AGENT - This is for testing only (USE_MOCK_AGENT is set)")
      return
    }

    if (options.args) {
      this.command = options.command
      this.args = options.args
    } else {
      const [command = "", ...args] = options.command.trim().split(/\s+/)
      this.command = command
      this.args = args
    }

    if (!Bun.which(this.command)) {
      throw new Error(
        `Agent command not found: "${this.command}". Please install it or update the config.`,
      )
    }
  }

  spawn(sessionId: string, workingDir: string): AgentProcessInfo {
    if (this.processes.has(sessionId)) {
      throw new Error(`Process already exists for session ${sessionId}`)
    }

    workingDir = resolve(workingDir)

    if (!existsSync(workingDir)) {
      mkdirSync(workingDir, { recursive: true })
      this.logger.info(`Created working directory: ${workingDir}`)
    }

    if (this.useMockAgent) {
      this.logger.warn(`⚠️  Spawning MOCK AGENT for session ${sessionId} (cwd ${workingDir})`)
    } else {
      this.logger.info(`Spawning agent: ${this.command} ${this.args.join(" ")} (cwd ${workingDir})`)
    }

    const child = spawn(this.command, this.args, {
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

  private getMockAgentPath(): string {
    const currentDir = dirname(fileURLToPath(import.meta.url))
    return join(currentDir, "mockAgent.ts")
  }
}
