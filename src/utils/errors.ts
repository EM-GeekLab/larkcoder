function hasMessage(value: unknown): value is { message: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof (value as { message: unknown }).message === "string"
  )
}

export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (hasMessage(error)) {
    return error.message
  }
  return String(error)
}

export class LarkCoderError extends Error {
  readonly code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = "LarkCoderError"
    this.code = code
  }
}

export class SessionNotFoundError extends LarkCoderError {
  constructor(identifier: string) {
    super(`Session not found: ${identifier}`, "SESSION_NOT_FOUND")
    this.name = "SessionNotFoundError"
  }
}

export class SessionStateError extends LarkCoderError {
  constructor(sessionId: string, currentStatus: string, action: string) {
    super(`Cannot ${action} session ${sessionId} in status ${currentStatus}`, "SESSION_STATE_ERROR")
    this.name = "SessionStateError"
  }
}

export class ProjectNotFoundError extends LarkCoderError {
  constructor(identifier: string) {
    super(`Project not found: ${identifier}`, "PROJECT_NOT_FOUND")
    this.name = "ProjectNotFoundError"
  }
}
