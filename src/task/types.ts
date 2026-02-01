export type TaskStatus =
  | "pending"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled"

export type Task = {
  id: string
  chatId: string
  threadId: string
  creatorId: string
  status: TaskStatus
  prompt: string
  summary?: string
  sessionId?: string
  processPort?: number
  workingDir: string
  docToken?: string
  cardMessageId?: string
  createdAt: string
  updatedAt: string
  completedAt?: string
  errorMessage?: string
}

export type CreateTaskParams = {
  chatId: string
  threadId: string
  creatorId: string
  prompt: string
  workingDir: string
  docToken?: string
}
