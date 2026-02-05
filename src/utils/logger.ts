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

export function getLogLevel(): LogLevel {
  return currentLevel
}

export function createLogger(options?: { prefix?: string }): Logger {
  const prefix = options?.prefix

  let newLogger = logger.child()
  if (prefix) {
    newLogger = newLogger.withPrefix(`[${prefix}]`)
  }
  return newLogger
}
