import { format } from "date-fns"
import type { Session } from "../../session/types"
import { truncate } from "./common"

type SessionListCardData = {
  sessions: Session[]
  currentSessionId?: string
}

type SessionListStyle = {
  borderColor: string
  icon: { token: string; color?: string }
  action: string
}

function buildSessionListBase(
  sessions: Session[],
  currentSessionId: string | undefined,
  style: SessionListStyle,
): Record<string, unknown> {
  const interactiveContainers = sessions.map((s) => {
    const prompt = truncate(s.initialPrompt, 60)
    const isCurrent = currentSessionId !== undefined && s.id === currentSessionId
    const time = format(new Date(s.updatedAt), "yyyy-MM-dd HH:mm:ss")
    return {
      tag: "interactive_container",
      width: "fill",
      height: "auto",
      horizontal_align: "left",
      background_style: "default",
      has_border: true,
      border_color: style.borderColor,
      corner_radius: "8px",
      padding: "4px 12px 4px 12px",
      behaviors: [
        {
          type: "callback",
          value: {
            action: style.action,
            session_id: s.id,
          },
        },
      ],
      elements: [
        {
          tag: "column_set",
          flex_mode: "flow",
          background_style: "default",
          columns: [
            {
              tag: "column",
              width: "weighted",
              weight: 1,
              vertical_align: "center",
              elements: [
                {
                  tag: "markdown",
                  content: prompt,
                  icon: {
                    tag: "standard_icon",
                    ...style.icon,
                  },
                },
              ],
            },
            ...(isCurrent
              ? [
                  {
                    tag: "column",
                    width: "auto",
                    weight: 1,
                    vertical_align: "center",
                    elements: [
                      {
                        tag: "markdown",
                        content: "<font color='grey'>current</font>",
                        text_size: "notation",
                      },
                    ],
                  },
                ]
              : []),
            {
              tag: "column",
              width: "auto",
              weight: 1,
              vertical_align: "center",
              elements: [
                {
                  tag: "markdown",
                  content: `<font color='grey'>${time}</font>`,
                  text_size: "notation",
                },
              ],
            },
          ],
        },
      ],
    }
  })

  return {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    body: {
      elements: [
        {
          tag: "column_set",
          flex_mode: "none",
          background_style: "default",
          columns: [
            {
              tag: "column",
              width: "weighted",
              weight: 1,
              vertical_align: "top",
              vertical_spacing: "8px",
              elements: interactiveContainers,
            },
          ],
        },
      ],
    },
  }
}

export function buildSessionListCard(data: SessionListCardData): Record<string, unknown> {
  return buildSessionListBase(data.sessions, data.currentSessionId, {
    borderColor: "grey",
    icon: { token: "chat-history_outlined" },
    action: "session_select",
  })
}

export function buildSessionDeleteCard(data: SessionListCardData): Record<string, unknown> {
  return buildSessionListBase(data.sessions, data.currentSessionId, {
    borderColor: "red-300",
    icon: { token: "delete-trash_outlined", color: "red" },
    action: "session_delete",
  })
}
