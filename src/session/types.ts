export type SessionStatus = "idle" | "running"

export type Session = {
  id: string
  chatId: string
  threadId: string
  creatorId: string
  status: SessionStatus
  initialPrompt: string
  acpSessionId?: string
  processPort?: number
  workingDir: string
  docToken?: string
  workingMessageId?: string
  isPlanMode: boolean
  createdAt: string
  updatedAt: string
}

export type CreateSessionParams = {
  chatId: string
  threadId: string
  creatorId: string
  initialPrompt: string
  workingDir: string
  docToken?: string
}
