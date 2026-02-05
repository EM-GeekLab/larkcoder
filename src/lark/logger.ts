import { LoggerLevel } from "@larksuiteoapi/node-sdk"
import { type LogLevel, createLogger, getLogLevel } from "../utils/logger"

const loggerLevelMap: Record<LogLevel, LoggerLevel> = {
  trace: LoggerLevel.trace,
  debug: LoggerLevel.debug,
  info: LoggerLevel.info,
  warn: LoggerLevel.warn,
  error: LoggerLevel.error,
  fatal: LoggerLevel.error,
}

export function getLarkLoggerLevel(): LoggerLevel {
  return loggerLevelMap[getLogLevel()]
}

function formatArg(arg: unknown): string {
  if (typeof arg === "string") {
    return arg
  }
  if (arg instanceof Error) {
    return arg.stack ?? arg.message
  }
  if (typeof arg === "object" && arg !== null) {
    return Bun.inspect(arg)
  }
  return String(arg)
}

function formatMsg(msg: unknown[]): string {
  return msg
    .flatMap((arg) => (Array.isArray(arg) ? arg : [arg]))
    .map(formatArg)
    .join(" ")
}

export function createLarkLogger(prefix: string): {
  error: (...msg: unknown[]) => void
  warn: (...msg: unknown[]) => void
  info: (...msg: unknown[]) => void
  debug: (...msg: unknown[]) => void
  trace: (...msg: unknown[]) => void
} {
  const l = createLogger({ prefix })
  return {
    error: (...msg: unknown[]) => l.error(formatMsg(msg)),
    warn: (...msg: unknown[]) => l.warn(formatMsg(msg)),
    info: (...msg: unknown[]) => l.info(formatMsg(msg)),
    debug: (...msg: unknown[]) => l.debug(formatMsg(msg)),
    trace: (...msg: unknown[]) => l.trace(formatMsg(msg)),
  }
}
