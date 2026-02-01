import type { Session } from "../session/types.js"

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) {
    return text
  }
  return `${text.slice(0, maxLen)}...`
}

export function buildMarkdownCard(content: string): Record<string, unknown> {
  return {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    body: {
      elements: [{ tag: "markdown", content }],
    },
  }
}

export const STREAMING_ELEMENT_ID = "md_stream"
export const PROCESSING_ELEMENT_ID = "processing_indicator"

export function buildStreamingCard(initialContent?: string): Record<string, unknown> {
  const hasContent = initialContent && initialContent.length > 0
  const placeholderText = "<font color='grey-500'>Pending...</font>"

  const elements: Record<string, unknown>[] = [
    // Streaming markdown element - shows placeholder when no content, actual content when available
    {
      tag: "markdown",
      content: hasContent ? initialContent : placeholderText,
      element_id: STREAMING_ELEMENT_ID,
    },
    // Add processing indicator
    {
      tag: "markdown",
      content: "<font color='grey-500'>Processing...</font>",
      text_size: "notation",
      element_id: PROCESSING_ELEMENT_ID,
      icon: {
        tag: "standard_icon",
        token: "down-right_outlined",
        color: "light_grey",
      },
    },
  ]

  return {
    schema: "2.0",
    config: {
      streaming_mode: true,
      update_multi: true,
      summary: { content: "[生成中...]" },
      streaming_config: {
        print_frequency_ms: { default: 50 },
        print_step: { default: 2 },
        print_strategy: "fast",
      },
    },
    body: {
      elements,
    },
  }
}

export function buildStreamingCloseSettings(summaryContent: string): Record<string, unknown> {
  return {
    config: {
      streaming_mode: false,
      update_multi: true,
      summary: { content: summaryContent },
    },
  }
}

type PermissionCardData = {
  sessionId: string
  toolDescription: string
  options: Array<{ optionId: string; label: string }>
}

export function buildPermissionCard(data: PermissionCardData): Record<string, unknown> {
  const interactiveContainers = data.options.map((opt) => ({
    tag: "interactive_container",
    width: "fill",
    height: "auto",
    horizontal_align: "left",
    background_style: "default",
    has_border: true,
    border_color: "grey",
    corner_radius: "8px",
    padding: "4px 12px 4px 12px",
    behaviors: [
      {
        type: "callback",
        value: {
          action: "permission_select",
          session_id: data.sessionId,
          option_id: opt.optionId,
        },
      },
    ],
    elements: [
      {
        tag: "markdown",
        content: opt.label,
      },
    ],
  }))

  return {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content: data.toolDescription,
        },
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

type SessionListCardData = {
  sessions: Session[]
}

export function buildSessionListCard(data: SessionListCardData): Record<string, unknown> {
  const interactiveContainers = data.sessions.map((s) => {
    const prompt = truncate(s.initialPrompt, 60)
    const time = s.updatedAt.replace("T", " ").slice(0, 19)
    return {
      tag: "interactive_container",
      width: "fill",
      height: "auto",
      horizontal_align: "left",
      background_style: "default",
      has_border: true,
      border_color: "grey",
      corner_radius: "8px",
      padding: "4px 12px 4px 12px",
      behaviors: [
        {
          type: "callback",
          value: {
            action: "session_select",
            session_id: s.id,
          },
        },
      ],
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
              vertical_align: "center",
              elements: [
                {
                  tag: "markdown",
                  content: prompt,
                  icon: {
                    tag: "standard_icon",
                    token: "chat-history_outlined",
                  },
                },
              ],
            },
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

export function buildSessionDeleteCard(data: SessionListCardData): Record<string, unknown> {
  const interactiveContainers = data.sessions.map((s) => {
    const prompt = truncate(s.initialPrompt, 60)
    const time = s.updatedAt.replace("T", " ").slice(0, 19)
    return {
      tag: "interactive_container",
      width: "fill",
      height: "auto",
      horizontal_align: "left",
      background_style: "default",
      has_border: true,
      border_color: "grey",
      corner_radius: "8px",
      padding: "4px 12px 4px 12px",
      behaviors: [
        {
          type: "callback",
          value: {
            action: "session_delete",
            session_id: s.id,
          },
        },
      ],
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
              vertical_align: "center",
              elements: [
                {
                  tag: "markdown",
                  content: prompt,
                  icon: {
                    tag: "standard_icon",
                    token: "chat-history_outlined",
                  },
                },
              ],
            },
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

type ModelSelectCardData = {
  sessionId: string
  models: Array<{ modelId: string; label: string }>
}

export function buildModelSelectCard(data: ModelSelectCardData): Record<string, unknown> {
  const interactiveContainers = data.models.map((m) => ({
    tag: "interactive_container",
    width: "fill",
    height: "auto",
    horizontal_align: "left",
    background_style: "default",
    has_border: true,
    border_color: "grey",
    corner_radius: "8px",
    padding: "4px 12px 4px 12px",
    behaviors: [
      {
        type: "callback",
        value: {
          action: "model_select",
          session_id: data.sessionId,
          model_id: m.modelId,
        },
      },
    ],
    elements: [
      {
        tag: "markdown",
        content: m.label,
      },
    ],
  }))

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

export function buildSelectedCard(text: string): Record<string, unknown> {
  return {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    body: {
      elements: [{ tag: "markdown", content: text }],
    },
  }
}

type PermissionSelectedCardData = {
  toolDescription: string
  selectedLabel: string
}

export function buildPermissionSelectedCard(
  data: PermissionSelectedCardData,
): Record<string, unknown> {
  return {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content: data.toolDescription,
        },
        {
          tag: "markdown",
          content: `**已选择：** ${data.selectedLabel}`,
        },
      ],
    },
  }
}
