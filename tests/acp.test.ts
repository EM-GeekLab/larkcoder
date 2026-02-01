import * as acp from "@agentclientprotocol/sdk"
/**
 * Integration test for ACP (Agent Client Protocol) communication with Claude Code.
 *
 * Requires `claude` CLI to be installed and available in PATH.
 * Set CLAUDECODE=1 to run: CLAUDECODE=1 bun run test
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { spawn, type ChildProcess } from "node:child_process"
import { Readable, Writable } from "node:stream"

const TIMEOUT_MS = 120_000

describe.skipIf(!process.env.CLAUDECODE)("ACP Integration", () => {
  let agentProcess: ChildProcess
  let connection: acp.ClientSideConnection
  let sessionId: string

  const sessionUpdates: acp.SessionNotification[] = []

  beforeAll(async () => {
    // Spawn claude as a subprocess with stdio pipes
    agentProcess = spawn("claude", [], {
      stdio: ["pipe", "pipe", "inherit"],
      env: {
        ...process.env,
        // Ensure non-interactive mode
        DISABLE_INTERACTIVITY: "1",
      },
    })

    expect(agentProcess.stdin).toBeTruthy()
    expect(agentProcess.stdout).toBeTruthy()

    // Create ndjson stream over stdio
    // ndJsonStream(output, input): output is writable (to agent stdin), input is readable (from agent stdout)
    const toAgent = Writable.toWeb(
      agentProcess.stdin!,
    ) as WritableStream<Uint8Array>
    const fromAgent = Readable.toWeb(
      agentProcess.stdout!,
    ) as ReadableStream<Uint8Array>
    const stream = acp.ndJsonStream(toAgent, fromAgent)

    // Create client that collects session updates
    const client: acp.Client = {
      async sessionUpdate(params) {
        sessionUpdates.push(params)
      },
      async requestPermission(params) {
        // Auto-approve all permissions in test
        const option = params.options[0]
        if (!option) {
          return { outcome: { outcome: "cancelled" } }
        }
        return {
          outcome: { outcome: "selected", optionId: option.optionId },
        }
      },
    }

    connection = new acp.ClientSideConnection((_agent) => client, stream)
  }, TIMEOUT_MS)

  afterAll(() => {
    agentProcess?.kill("SIGTERM")
  })

  it(
    "initializes connection",
    async () => {
      const result = await connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      })

      expect(result.protocolVersion).toBe(acp.PROTOCOL_VERSION)
      expect(result.agentInfo).toBeDefined()
      console.log("Agent info:", result.agentInfo)
    },
    TIMEOUT_MS,
  )

  it(
    "creates a new session",
    async () => {
      const result = await connection.newSession({
        cwd: process.cwd(),
        mcpServers: [],
      })

      expect(result.sessionId).toBeTruthy()
      sessionId = result.sessionId
      console.log("Session ID:", sessionId)
    },
    TIMEOUT_MS,
  )

  it(
    "sends a prompt and receives a response",
    async () => {
      expect(sessionId).toBeTruthy()

      sessionUpdates.length = 0

      const result = await connection.prompt({
        sessionId,
        prompt: [
          {
            type: "text",
            text: 'Reply with exactly the text "hello from claude" and nothing else.',
          },
        ],
      })

      expect(result.stopReason).toBeDefined()
      console.log("Stop reason:", result.stopReason)
      console.log("Session updates received:", sessionUpdates.length)

      // Should have received at least some session updates (message chunks)
      expect(sessionUpdates.length).toBeGreaterThan(0)

      // Collect text from agent_message_chunk updates
      const textChunks: string[] = []
      for (const update of sessionUpdates) {
        const u = update.update as Record<string, unknown> | undefined
        if (u?.sessionUpdate === "agent_message_chunk") {
          const content = u.content as
            | { type: string; text?: string }
            | undefined
          if (content?.type === "text" && content.text) {
            textChunks.push(content.text)
          }
        }
      }

      const fullResponse = textChunks.join("")
      console.log("Agent response:", fullResponse)
      expect(fullResponse.toLowerCase()).toContain("hello from claude")
    },
    TIMEOUT_MS,
  )
})
