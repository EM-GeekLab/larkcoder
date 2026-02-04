import type * as acp from "@agentclientprotocol/sdk"
import type { ThrottledFunction } from "radashi"
import type { AgentClient } from "../agent/types"
import type { ShellProcess } from "../command/shellExecutor"
import type { CardAction } from "../lark/types"

export const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000
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
  label?: string
  title: string
  startedAt: number
}

export type StreamingCard = {
  cardId: string
  messageId: string

  activeElementId: string | null
  activeElementType: "message" | "thought" | null
  elementCounter: number

  accumulatedText: string
  lastFlushedText: string
  throttledFlush: ThrottledFunction<[]>

  createdAt: number
  streamingOpen: boolean
  streamingOpenedAt: number
  placeholderReplaced: boolean
}

export type PlanEntry = {
  content: string
  priority: string
  status: string
}

export type ActiveSession = {
  sessionId: string
  client: AgentClient
  acpSessionId: string
  availableCommands: acp.AvailableCommand[]
  commandsReady: PromiseWithResolvers<void>
  availableModels: acp.ModelInfo[]
  availableModes: acp.SessionMode[]
  currentMode: string
  currentModel?: string
  currentPlan?: PlanEntry[]
  configOptions?: acp.SessionConfigOption[]
  sessionTitle?: string
  agentCapabilities?: acp.AgentCapabilities
  streamingCard?: StreamingCard
  streamingCardPending?: Promise<void>
  permissionResolvers: Map<string, PermissionResolver>
  toolCallElements: Map<string, ToolCallElementInfo>
  cardSequences: Map<string, number>
  shellProcess?: ShellProcess
}

export type SessionLockFn = <T>(sessionId: string, fn: () => Promise<T>) => Promise<T>
export type ActiveSessionLookup = (sessionId: string) => ActiveSession | undefined

export type SelectProjectResult = { projectTitle: string; sessionPrompt?: string }

export type ProjectCallbacks = {
  handleFormSubmit: (action: CardAction) => Promise<void>
  handleEditFormSubmit: (action: CardAction) => Promise<void>
  selectProject: (chatId: string, projectId: string) => Promise<SelectProjectResult>
  setActiveProject: (chatId: string, projectId: string) => void
  clearActiveProject: (chatId: string) => void
}
