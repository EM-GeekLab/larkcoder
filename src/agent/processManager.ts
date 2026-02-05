import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { Logger } from "../utils/logger"
import type { AgentProcessInfo } from "./types"

export type ProcessManagerOptions = {
  command: string
  logger: Logger
}

export class ProcessManager {
  private processes = new Map<string, { process: ChildProcess }>()
  private command: string
  private logger: Logger
  private useMockAgent: boolean

  constructor(options: ProcessManagerOptions) {
    this.command = options.command
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

    workingDir = resolve(workingDir)

    if (!existsSync(workingDir)) {
      mkdirSync(workingDir, { recursive: true })
      this.logger.info(`Created working directory: ${workingDir}`)
    }

    const [command = "", ...args] = this.useMockAgent
      ? ["bun", this.getMockAgentPath()]
      : this.command.trim().split(/\s+/)

    if (this.useMockAgent) {
      this.logger.warn(`⚠️  Spawning MOCK AGENT for session ${sessionId} (cwd ${workingDir})`)
    } else {
      this.logger.info(`Spawning agent: ${this.command} (cwd ${workingDir})`)
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

  private getMockAgentPath(): string {
    const currentDir = dirname(fileURLToPath(import.meta.url))
    return join(currentDir, "mockAgent.ts")
  }
}
