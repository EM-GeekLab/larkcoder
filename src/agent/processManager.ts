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

  spawn(taskId: string, workingDir: string): AgentProcessInfo {
    if (this.processes.has(taskId)) {
      throw new Error(`Process already exists for task ${taskId}`)
    }

    this.logger.info(
      `Spawning agent: ${this.command} ${this.args.join(" ")} (cwd ${workingDir})`,
    )

    const child = spawn(this.command, this.args, {
      cwd: workingDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    })

    this.processes.set(taskId, { process: child })

    child.stderr?.on("data", (data: Buffer) => {
      this.logger.warn(`[agent:${taskId}:stderr] ${data.toString().trim()}`)
    })

    child.on("exit", (code, signal) => {
      this.logger.info(
        `Agent process exited: task=${taskId} code=${code} signal=${signal}`,
      )
      this.processes.delete(taskId)
    })

    return {
      taskId,
      process: child,
      pid: child.pid ?? 0,
      kill: () => {
        child.kill("SIGTERM")
      },
    }
  }

  kill(taskId: string): void {
    const entry = this.processes.get(taskId)
    if (!entry) {
      return
    }
    this.logger.info(`Killing agent process for task ${taskId}`)
    entry.process.kill("SIGTERM")
    this.processes.delete(taskId)
  }

  isAlive(taskId: string): boolean {
    const entry = this.processes.get(taskId)
    return entry !== undefined && entry.process.exitCode === null
  }

  getProcess(taskId: string): ChildProcess | undefined {
    return this.processes.get(taskId)?.process
  }

  killAll(): void {
    for (const [taskId, entry] of this.processes) {
      this.logger.info(`Killing agent process for task ${taskId}`)
      entry.process.kill("SIGTERM")
    }
    this.processes.clear()
  }
}
