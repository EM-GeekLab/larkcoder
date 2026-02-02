import type * as acp from "@agentclientprotocol/sdk"
import type { AgentClient } from "../agent/types.js"

export const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000
export const STREAM_FLUSH_INTERVAL_MS = 150
export const STREAM_AUTO_CLOSE_MS = 10 * 60 * 1000
export const STREAM_MAX_CONTENT_LENGTH = 100_000

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) {
    return `${totalSeconds}s`
  }
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
}

export type PermissionResolver = {
  resolve: (resp: acp.RequestPermissionResponse) => void
  cardMessageId: string
  timer: ReturnType<typeof setTimeout>
  toolDescription: string
  options: Array<{ optionId: string; label: string }>
}

export type ToolCallElementInfo = {
  elementId: string
  cardId: string
  kind?: string
  title: string
  startedAt: number
}

export type StreamingCard = {
  cardId: string
  messageId: string

  activeElementId: string | null
  elementCounter: number

  accumulatedText: string
  lastFlushedText: string
  flushTimer: ReturnType<typeof setTimeout> | null

  createdAt: number
  streamingOpen: boolean
  streamingOpenedAt: number
  placeholderReplaced: boolean
}

export type ActiveSession = {
  sessionId: string
  client: AgentClient
  acpSessionId: string
  availableCommands: string[]
  availableModels: acp.ModelInfo[]
  currentMode: string
  currentModel?: string
  streamingCard?: StreamingCard
  streamingCardPending?: Promise<void>
  permissionResolvers: Map<string, PermissionResolver>
  toolCallElements: Map<string, ToolCallElementInfo>
  cardSequences: Map<string, number>
}

export type SessionLockFn = <T>(sessionId: string, fn: () => Promise<T>) => Promise<T>
export type ActiveSessionLookup = (sessionId: string) => ActiveSession | undefined
