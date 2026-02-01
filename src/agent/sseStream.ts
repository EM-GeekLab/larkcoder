import type { AnyMessage, Stream } from "@agentclientprotocol/sdk"
import type { Logger } from "../utils/logger.js"

export type SseStreamOptions = {
  streamUrl: string
  sendUrl?: string
  headers?: Record<string, string>
  signal?: AbortSignal
  logger: Logger
  retryDelayMs?: number
  heartbeatTimeoutMs?: number
}

export function createSseStream(options: SseStreamOptions): Stream {
  const readable = createReadableStream(options)
  const writable = createWritableStream(options)
  return { readable, writable }
}

function createReadableStream(
  options: SseStreamOptions,
): ReadableStream<AnyMessage> {
  const {
    streamUrl,
    headers,
    signal,
    logger,
    retryDelayMs = 1000,
    heartbeatTimeoutMs = 45000,
  } = options

  return new ReadableStream<AnyMessage>({
    async start(controller) {
      let attempt = 0

      const connect = async (): Promise<void> => {
        try {
          const response = await fetch(streamUrl, {
            headers: {
              accept: "text/event-stream",
              ...headers,
            },
            signal,
          })

          if (!response.ok) {
            throw new Error(
              `SSE connection failed: ${response.status} ${response.statusText}`,
            )
          }

          if (!response.body) {
            throw new Error("SSE response has no body")
          }

          attempt = 0
          let lastMessageAt = Date.now()
          let buffer = ""

          const reader = response.body.getReader()
          const decoder = new TextDecoder()

          const heartbeatCheck = setInterval(() => {
            if (Date.now() - lastMessageAt > heartbeatTimeoutMs) {
              logger.warn("SSE heartbeat timeout, reconnecting...")
              reader.cancel().catch(() => {})
              clearInterval(heartbeatCheck)
            }
          }, 15000)

          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) {
                break
              }

              lastMessageAt = Date.now()
              buffer += decoder.decode(value, { stream: true })
              const lines = buffer.split("\n")
              buffer = lines.pop() ?? ""

              let dataLines: string[] = []
              for (const line of lines) {
                if (line.startsWith("data: ")) {
                  dataLines.push(line.slice(6))
                } else if (line.trim() === "" && dataLines.length > 0) {
                  const data = dataLines.join("\n")
                  dataLines = []
                  try {
                    const msg = JSON.parse(data) as AnyMessage
                    controller.enqueue(msg)
                  } catch {
                    logger.warn("Failed to parse SSE message")
                  }
                }
              }
            }
          } finally {
            clearInterval(heartbeatCheck)
          }

          if (!signal?.aborted) {
            await reconnect()
          }
        } catch (error: unknown) {
          if (signal?.aborted) {
            controller.close()
            return
          }
          logger.warn(
            `SSE connection error: ${error instanceof Error ? error.message : String(error)}`,
          )
          await reconnect()
        }
      }

      const reconnect = async (): Promise<void> => {
        if (signal?.aborted) {
          controller.close()
          return
        }
        attempt += 1
        const delay = Math.min(
          retryDelayMs * Math.pow(2, Math.min(attempt - 1, 5)),
          30000,
        )
        logger.info(`SSE reconnecting in ${delay}ms (attempt ${attempt})`)
        await new Promise((resolve) => setTimeout(resolve, delay))
        if (!signal?.aborted) {
          await connect()
        } else {
          controller.close()
        }
      }

      await connect()
    },
  })
}

function createWritableStream(
  options: SseStreamOptions,
): WritableStream<AnyMessage> {
  const { streamUrl, sendUrl, headers, signal, logger } = options
  const targetUrl = sendUrl ?? streamUrl

  return new WritableStream<AnyMessage>({
    async write(message) {
      const maxRetries = 3
      for (let attempt = 0; attempt < maxRetries; attempt += 1) {
        try {
          const response = await fetch(targetUrl, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...headers,
            },
            body: JSON.stringify(message),
            signal,
          })
          if (response.ok) {
            return
          }
          logger.warn(
            `SSE write failed (${response.status}), attempt ${attempt + 1}/${maxRetries}`,
          )
        } catch (error: unknown) {
          if (signal?.aborted) {
            throw error
          }
          logger.warn(
            `SSE write error: ${error instanceof Error ? error.message : String(error)}, attempt ${attempt + 1}/${maxRetries}`,
          )
        }
        if (attempt < maxRetries - 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * (attempt + 1)),
          )
        }
      }
      throw new Error(`SSE write failed after ${maxRetries} attempts`)
    },
  })
}
