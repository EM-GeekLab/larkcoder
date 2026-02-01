import { spawn } from "node:child_process"

export type CommandResult = {
  command: string
  args: string[]
  exitCode: number | null
  stdout: string
  stderr: string
}

export async function runCommand(
  command: string,
  args: string[],
): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString()
    })

    child.on("error", (error) => {
      reject(error)
    })

    child.on("close", (code) => {
      resolve({
        command,
        args,
        exitCode: code,
        stdout,
        stderr,
      })
    })
  })
}
