export type SessionStatus = "idle" | "running"

export type Session = {
  id: string
  chatId: string
  threadId: string
  creatorId: string
  status: SessionStatus
  initialPrompt: string
  acpSessionId?: string
  workingDir: string
  /** 飞书文档 token，用于注入 system prompt 上下文及 agent 读写文档 */
  docToken?: string
  /** 当前 streaming card 所在的飞书消息 ID，streaming 结束后清空 */
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
