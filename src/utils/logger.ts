import { getSimplePrettyTerminal } from "@loglayer/transport-simple-pretty-terminal"
import { LogLayer } from "loglayer"
import { serializeError } from "serialize-error"

export type Logger = LogLayer

export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

function defaultLogLevel(): LogLevel {
  return process.env.NODE_ENV === "production" ? "info" : "trace"
}

function buildLogger(level: LogLevel): LogLayer {
  return new LogLayer({
    errorSerializer: serializeError,
    transport: getSimplePrettyTerminal({
      runtime: "node",
      level,
    }),
  })
}

let currentLevel: LogLevel = defaultLogLevel()
let logger = buildLogger(currentLevel)

export function setLogLevel(level: LogLevel): void {
  currentLevel = level
  logger = buildLogger(currentLevel)
}

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
