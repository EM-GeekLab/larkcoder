import { format } from "date-fns"
import type { Session } from "../../session/types"
import { buildListCard, truncate, type ListItem } from "./common"

type SessionListCardData = {
  sessions: Session[]
  currentSessionId?: string
  title?: string
  descriptions?: Map<string, string>
}

type SessionListStyle = {
  borderColor: string
  icon: { token: string; color?: string }
  action: string
}

function toListItems(
  sessions: Session[],
  currentSessionId: string | undefined,
  style: SessionListStyle,
  descriptions?: Map<string, string>,
): ListItem[] {
  return sessions.map((s) => ({
    label: truncate(s.initialPrompt, 60),
    description: descriptions?.get(s.id),
    isCurrent: currentSessionId !== undefined && s.id === currentSessionId,
    icon: style.icon,
    time: format(new Date(s.updatedAt), "yyyy-MM-dd HH:mm:ss"),
    callbackValue: { action: style.action, session_id: s.id },
  }))
}

export function buildSessionListCard(data: SessionListCardData): Record<string, unknown> {
  const items = toListItems(
    data.sessions,
    data.currentSessionId,
    {
      borderColor: "grey",
      icon: { token: "chat-history_outlined" },
      action: "session_select",
    },
    data.descriptions,
  )
  return buildListCard(items, { title: data.title, borderColor: "grey" })
}

export function buildSessionDeleteCard(data: SessionListCardData): Record<string, unknown> {
  const items = toListItems(
    data.sessions,
    data.currentSessionId,
    {
      borderColor: "red-300",
      icon: { token: "delete-trash_outlined", color: "red" },
      action: "session_delete",
    },
    data.descriptions,
  )
  return buildListCard(items, { title: data.title, borderColor: "red-300" })
}
