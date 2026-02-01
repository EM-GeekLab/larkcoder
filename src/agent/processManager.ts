import { spawn, type ChildProcess } from "node:child_process"
import type { Logger } from "../utils/logger.js"
import type { AgentProcessInfo } from "./types.js"

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

  constructor(options: ProcessManagerOptions) {
    this.command = options.command
    this.args = options.args
    this.logger = options.logger
  }

  spawn(sessionId: string, workingDir: string): AgentProcessInfo {
    if (this.processes.has(sessionId)) {
      throw new Error(`Process already exists for session ${sessionId}`)
    }

    this.logger.info(
      `Spawning agent: ${this.command} ${this.args.join(" ")} (cwd ${workingDir})`,
    )

    const child = spawn(this.command, this.args, {
      cwd: workingDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    })

    this.processes.set(sessionId, { process: child })

    child.stderr?.on("data", (data: Buffer) => {
      this.logger.warn(`[agent:${sessionId}:stderr] ${data.toString().trim()}`)
    })

    child.on("exit", (code, signal) => {
      this.logger.info(
        `Agent process exited: session=${sessionId} code=${code} signal=${signal}`,
      )
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
}
