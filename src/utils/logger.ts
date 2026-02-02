import { getSimplePrettyTerminal } from "@loglayer/transport-simple-pretty-terminal"
import { LogLayer } from "loglayer"
import { serializeError } from "serialize-error"

export type Logger = LogLayer

const logger = new LogLayer({
  errorSerializer: serializeError,
  transport: getSimplePrettyTerminal({
    runtime: "node",
    level: process.env.NODE_ENV === "production" ? "info" : "trace",
  }),
})

export function createLogger(options?: { prefix?: string }): Logger {
  const prefix = options?.prefix

  let newLogger = logger.child()
  if (prefix) {
    newLogger = newLogger.withPrefix(`[${prefix}]`)
  }
  return newLogger
}

/**
 * Creates an adapter that bridges our Logger to the Lark SDK's Logger interface.
 * Lark SDK expects { error, warn, info, debug, trace } with (...msg: any[]) => void.
 */
export function createLarkLogger(prefix: string): {
  error: (...msg: unknown[]) => void
  warn: (...msg: unknown[]) => void
  info: (...msg: unknown[]) => void
  debug: (...msg: unknown[]) => void
  trace: (...msg: unknown[]) => void
} {
  const l = createLogger({ prefix })
  return {
    error: (...msg: unknown[]) => l.error(msg.map(String).join(" ")),
    warn: (...msg: unknown[]) => l.warn(msg.map(String).join(" ")),
    info: (...msg: unknown[]) => l.info(msg.map(String).join(" ")),
    debug: (...msg: unknown[]) => l.debug(msg.map(String).join(" ")),
    trace: (...msg: unknown[]) => l.trace(msg.map(String).join(" ")),
  }
}
