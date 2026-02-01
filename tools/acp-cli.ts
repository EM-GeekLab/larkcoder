import * as acp from "@agentclientprotocol/sdk"
import { spawn } from "node:child_process"
import * as readline from "node:readline"
import { Readable, Writable } from "node:stream"

const DIM = "\x1b[2m"
const RESET = "\x1b[0m"

function parseArgs(): { cwd: string } {
  const args = process.argv.slice(2)
  let cwd = process.cwd()
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--cwd" && args[i + 1]) {
      cwd = args[i + 1]!
      i += 1
    }
  }
  return { cwd }
}

async function main(): Promise<void> {
  const { cwd } = parseArgs()

  console.log(`Spawning claude-code-acp (cwd: ${cwd})...`)

  const child = spawn("claude-code-acp", [], {
    cwd,
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env },
  })

  if (!child.stdin || !child.stdout) {
    console.error("Failed to get stdio pipes")
    process.exit(1)
  }

  child.on("exit", (code, signal) => {
    console.log(`\nclaude-code-acp exited (code=${code}, signal=${signal})`)
    process.exit(code ?? 1)
  })

  const toAgent = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>
  const fromAgent = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
  const stream = acp.ndJsonStream(toAgent, fromAgent)

  const client: acp.Client = {
    async sessionUpdate(params) {
      const update = params.update as Record<string, unknown> | undefined
      if (!update) {
        return
      }
      const updateType = update.sessionUpdate as string | undefined
      switch (updateType) {
        case "agent_message_chunk": {
          const content = update.content as { type: string; text?: string } | undefined
          if (content?.type === "text" && content.text) {
            process.stdout.write(content.text)
          }
          break
        }
        case "agent_thought_chunk": {
          const content = update.content as { type: string; text?: string } | undefined
          if (content?.type === "text" && content.text) {
            process.stdout.write(`${DIM}${content.text}${RESET}`)
          }
          break
        }
        case "tool_call": {
          const title = (update.title as string) ?? "unknown"
          console.log(`\n[tool] ${title}`)
          break
        }
        case "tool_result": {
          console.log("[tool result]")
          break
        }
      }
    },
    async requestPermission(params) {
      const option = params.options[0]
      if (!option) {
        return { outcome: { outcome: "cancelled" } }
      }
      console.log(`\n[auto-approve] ${option.name ?? option.optionId}`)
      return {
        outcome: { outcome: "selected", optionId: option.optionId },
      }
    },
  }

  const connection = new acp.ClientSideConnection((_agent) => client, stream)

  console.log("Initializing ACP connection...")
  const initResult = await connection.initialize({
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: {},
    clientInfo: { name: "acp-cli", version: "0.1.0" },
  })
  console.log(
    `Connected: protocol v${initResult.protocolVersion}, agent: ${initResult.agentInfo?.name ?? "unknown"}`,
  )

  console.log("Creating session...")
  const sessionResult = await connection.newSession({
    cwd,
    mcpServers: [],
  })
  const sessionId = sessionResult.sessionId
  console.log(`Session: ${sessionId}\n`)

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const promptUser = (): void => {
    rl.question("> ", async (input) => {
      const text = input.trim()
      if (!text) {
        promptUser()
        return
      }

      try {
        const result = await connection.prompt({
          sessionId,
          prompt: [{ type: "text", text }],
        })
        console.log(`\n[stop: ${result.stopReason}]\n`)
      } catch (error: unknown) {
        const msg =
          error instanceof Error
            ? error.message
            : typeof error === "object" &&
                error !== null &&
                "message" in error &&
                typeof (error as Record<string, unknown>).message === "string"
              ? ((error as Record<string, unknown>).message as string)
              : String(error)
        console.error(`\nError: ${msg}\n`)
      }

      promptUser()
    })
  }

  promptUser()

  // Handle Ctrl+C
  process.on("SIGINT", () => {
    console.log("\nShutting down...")
    rl.close()
    child.kill("SIGTERM")
    process.exit(0)
  })
}

main().catch((error: unknown) => {
  console.error("Fatal:", error)
  process.exit(1)
})
