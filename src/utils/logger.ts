import { getSimplePrettyTerminal } from "@loglayer/transport-simple-pretty-terminal";
import { LogLayer } from "loglayer";
import { serializeError } from "serialize-error";

export type Logger = LogLayer;

const logger = new LogLayer({
  errorSerializer: serializeError,
  transport: getSimplePrettyTerminal({
    runtime: "node",
    level: process.env.NODE_ENV === "production" ? "info" : "trace",
  }),
});

export function createLogger(options?: { prefix?: string }): Logger {
  const prefix = options?.prefix;

  let newLogger = logger.child();
  if (prefix) {
    newLogger = newLogger.withPrefix(prefix);
  }
  return newLogger;
}
