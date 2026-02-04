import { spawn } from "node:child_process"
import type { Logger } from "../utils/logger"

export type ShellProcess = {
  kill: () => void
  pid: number
}

export class ShellExecutor {
  constructor(private logger: Logger) {}

  execute(
    command: string,
    workingDir: string,
    timeout: number,
    onStdout: (data: string) => void,
    onStderr: (data: string) => void,
    onExit: (code: number | null, signal: string | null) => void,
  ): ShellProcess {
    // Spawn with shell: true for full shell features (pipes, redirects, etc.)
    const child = spawn(command, {
      cwd: workingDir,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"], // No stdin, pipe stdout/stderr
      env: process.env,
    })

    // Stream stdout
    child.stdout?.on("data", (data: Buffer) => {
      onStdout(data.toString())
    })

    // Stream stderr
    child.stderr?.on("data", (data: Buffer) => {
      onStderr(data.toString())
    })

    // Handle exit
    child.on("exit", (code, signal) => {
      if (timer) {
        clearTimeout(timer)
      }
      this.logger.debug(`Shell command exited: code=${code} signal=${signal}`)
      onExit(code, signal)
    })

    // Timeout protection
    const timer = setTimeout(() => {
      this.logger.warn(`Shell command timeout, killing process: pid=${child.pid}`)
      child.kill("SIGTERM")
      // Force kill after 5s if SIGTERM doesn't work
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL")
        }
      }, 5000)
    }, timeout)

    return {
      kill: () => {
        if (timer) {
          clearTimeout(timer)
        }
        child.kill("SIGTERM")
        setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGKILL")
          }
        }, 5000)
      },
      pid: child.pid ?? -1,
    }
  }
}
