import { format } from "date-fns"
import type { Session } from "../../session/types"
import { truncate } from "./common"

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

function buildSessionListBase(
  sessions: Session[],
  currentSessionId: string | undefined,
  style: SessionListStyle,
  title?: string,
  descriptions?: Map<string, string>,
): Record<string, unknown> {
  const interactiveContainers = sessions.map((s) => {
    const prompt = truncate(s.initialPrompt, 60)
    const description = descriptions?.get(s.id)
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
      vertical_spacing: description ? "0px" : undefined,
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
        ...(description
          ? [
              {
                tag: "markdown",
                content: `<font color='grey'>${description}</font>`,
                text_size: "notation",
                margin: "0px 0px 0px 24px",
              },
            ]
          : []),
      ],
    }
  })

  const card: Record<string, unknown> = {
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

  if (title) {
    card.header = {
      title: { tag: "plain_text", content: title },
      template: "indigo",
    }
  }

  return card
}

export function buildSessionListCard(data: SessionListCardData): Record<string, unknown> {
  return buildSessionListBase(
    data.sessions,
    data.currentSessionId,
    {
      borderColor: "grey",
      icon: { token: "chat-history_outlined" },
      action: "session_select",
    },
    data.title,
    data.descriptions,
  )
}

export function buildSessionDeleteCard(data: SessionListCardData): Record<string, unknown> {
  return buildSessionListBase(
    data.sessions,
    data.currentSessionId,
    {
      borderColor: "red-300",
      icon: { token: "delete-trash_outlined", color: "red" },
      action: "session_delete",
    },
    data.title,
    data.descriptions,
  )
}
