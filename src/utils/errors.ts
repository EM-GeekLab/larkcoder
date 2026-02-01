export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as Record<string, unknown>).message === "string"
  ) {
    return (error as Record<string, unknown>).message as string
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

export class TaskNotFoundError extends LarkCoderError {
  constructor(identifier: string) {
    super(`Task not found: ${identifier}`, "TASK_NOT_FOUND")
    this.name = "TaskNotFoundError"
  }
}

export class TaskStateError extends LarkCoderError {
  constructor(taskId: string, currentStatus: string, action: string) {
    super(`Cannot ${action} task ${taskId} in status ${currentStatus}`, "TASK_STATE_ERROR")
    this.name = "TaskStateError"
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

export class AgentError extends LarkCoderError {
  readonly exitCode: number | null

  constructor(message: string, exitCode?: number | null) {
    super(message, "AGENT_ERROR")
    this.name = "AgentError"
    this.exitCode = exitCode ?? null
  }
}

export class AgentTimeoutError extends LarkCoderError {
  constructor(taskId: string) {
    super(`Agent timed out for task ${taskId}`, "AGENT_TIMEOUT")
    this.name = "AgentTimeoutError"
  }
}

export class LarkApiError extends LarkCoderError {
  readonly statusCode: number | undefined

  constructor(message: string, statusCode?: number) {
    super(message, "LARK_API_ERROR")
    this.name = "LarkApiError"
    this.statusCode = statusCode
  }
}
