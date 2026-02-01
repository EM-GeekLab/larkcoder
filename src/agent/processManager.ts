import getPort, { portNumbers } from "get-port"
import { spawn, type ChildProcess } from "node:child_process"
import type { Logger } from "../utils/logger.js"
import type { AgentProcessInfo } from "./types.js"

export type ProcessManagerOptions = {
  command: string
  args: string[]
  portRange: [number, number]
  logger: Logger
}

export class ProcessManager {
  private processes = new Map<string, { process: ChildProcess; port: number }>()
  private usedPorts = new Set<number>()
  private command: string
  private args: string[]
  private portRange: [number, number]
  private logger: Logger

  constructor(options: ProcessManagerOptions) {
    this.command = options.command
    this.args = options.args
    this.portRange = options.portRange
    this.logger = options.logger
  }

  async spawn(taskId: string, workingDir: string): Promise<AgentProcessInfo> {
    if (this.processes.has(taskId)) {
      throw new Error(`Process already exists for task ${taskId}`)
    }

    const port = await this.allocatePort()
    const renderedArgs = this.args.map((arg) =>
      arg.replace("{{PORT}}", String(port)),
    )

    this.logger.info(
      `Spawning agent: ${this.command} ${renderedArgs.join(" ")} (port ${port}, cwd ${workingDir})`,
    )

    const child = spawn(this.command, renderedArgs, {
      cwd: workingDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    })

    this.processes.set(taskId, { process: child, port })

    child.stdout?.on("data", (data: Buffer) => {
      this.logger.info(`[agent:${taskId}:stdout] ${data.toString().trim()}`)
    })

    child.stderr?.on("data", (data: Buffer) => {
      this.logger.warn(`[agent:${taskId}:stderr] ${data.toString().trim()}`)
    })

    child.on("exit", (code, signal) => {
      this.logger.info(
        `Agent process exited: task=${taskId} code=${code} signal=${signal}`,
      )
      this.processes.delete(taskId)
      this.usedPorts.delete(port)
    })

    await this.waitForPort(port)

    return {
      taskId,
      port,
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
    this.usedPorts.delete(entry.port)
  }

  isAlive(taskId: string): boolean {
    const entry = this.processes.get(taskId)
    return entry !== undefined && entry.process.exitCode === null
  }

  getPort(taskId: string): number | undefined {
    return this.processes.get(taskId)?.port
  }

  killAll(): void {
    for (const [taskId, entry] of this.processes) {
      this.logger.info(`Killing agent process for task ${taskId}`)
      entry.process.kill("SIGTERM")
    }
    this.processes.clear()
    this.usedPorts.clear()
  }

  private async allocatePort(): Promise<number> {
    const [min, max] = this.portRange
    const port = await getPort({
      port: portNumbers(min, max),
      exclude: [...this.usedPorts],
    })
    this.usedPorts.add(port)
    return port
  }

  private async waitForPort(port: number, timeoutMs = 30000): Promise<void> {
    const startTime = Date.now()
    const pollInterval = 500

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/sse`, {
          method: "GET",
          headers: { accept: "text/event-stream" },
          signal: AbortSignal.timeout(2000),
        })
        if (response.ok) {
          response.body?.cancel().catch(() => {})
          this.logger.info(`Agent port ${port} is ready`)
          return
        }
      } catch {
        // Port not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    }
    throw new Error(`Agent port ${port} not ready after ${timeoutMs}ms`)
  }
}
