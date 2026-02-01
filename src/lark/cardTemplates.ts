import type { Session } from "../session/types.js"

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) {
    return text
  }
  return `${text.slice(0, maxLen)}...`
}

export function buildMarkdownCard(content: string): Record<string, unknown> {
  return {
    config: { wide_screen_mode: true },
    elements: [{ tag: "markdown", content }],
  }
}

export const STREAMING_ELEMENT_ID = "md_stream"
export const PROCESSING_ELEMENT_ID = "processing_indicator"

export function buildStreamingCard(initialContent?: string): Record<string, unknown> {
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
      elements: [
        {
          tag: "markdown",
          content: initialContent ?? "",
          element_id: STREAMING_ELEMENT_ID,
        },
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
      ],
    },
  }
}

export function buildStreamingCloseSettings(summaryContent: string): Record<string, unknown> {
  return {
    config: {
      streaming_mode: false,
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
  const actions = data.options.map((opt, idx) => ({
    tag: "button",
    text: { tag: "plain_text", content: `${idx + 1}` },
    type: idx === 0 ? "primary" : "default",
    value: {
      action: "permission_select",
      session_id: data.sessionId,
      option_id: opt.optionId,
    },
  }))

  return {
    config: { wide_screen_mode: true },
    elements: [
      {
        tag: "markdown",
        content: data.toolDescription,
      },
      ...(data.options.length > 1
        ? [
            {
              tag: "markdown",
              content: data.options.map((opt, idx) => `**${idx + 1}.** ${opt.label}`).join("\n"),
            },
          ]
        : []),
      { tag: "action", actions },
    ],
  }
}

type SessionListCardData = {
  sessions: Session[]
}

export function buildSessionListCard(data: SessionListCardData): Record<string, unknown> {
  const lines = data.sessions.map((s, idx) => {
    const prompt = truncate(s.initialPrompt, 40)
    const time = s.updatedAt.replace("T", " ").slice(0, 19)
    return `**${idx + 1}.** ${prompt}  \`${time}\``
  })

  const actions = data.sessions.map((s, idx) => ({
    tag: "button",
    text: { tag: "plain_text", content: `${idx + 1}` },
    type: "default",
    value: {
      action: "session_select",
      session_id: s.id,
    },
  }))

  return {
    config: { wide_screen_mode: true },
    elements: [
      { tag: "markdown", content: lines.join("\n") },
      { tag: "action", actions },
    ],
  }
}

export function buildSessionDeleteCard(data: SessionListCardData): Record<string, unknown> {
  const lines = data.sessions.map((s, idx) => {
    const prompt = truncate(s.initialPrompt, 40)
    const time = s.updatedAt.replace("T", " ").slice(0, 19)
    return `**${idx + 1}.** ${prompt}  \`${time}\``
  })

  const actions = data.sessions.map((s, idx) => ({
    tag: "button",
    text: { tag: "plain_text", content: `${idx + 1}` },
    type: "danger",
    value: {
      action: "session_delete",
      session_id: s.id,
    },
  }))

  return {
    config: { wide_screen_mode: true },
    elements: [
      { tag: "markdown", content: lines.join("\n") },
      { tag: "action", actions },
    ],
  }
}

type ModelSelectCardData = {
  sessionId: string
  models: Array<{ modelId: string; label: string }>
}

export function buildModelSelectCard(data: ModelSelectCardData): Record<string, unknown> {
  const actions = data.models.map((m) => ({
    tag: "button",
    text: { tag: "plain_text", content: m.label },
    type: "default",
    value: {
      action: "model_select",
      session_id: data.sessionId,
      model_id: m.modelId,
    },
  }))

  return {
    config: { wide_screen_mode: true },
    elements: [{ tag: "action", actions }],
  }
}

export function buildSelectedCard(text: string): Record<string, unknown> {
  return {
    config: { wide_screen_mode: true },
    elements: [{ tag: "markdown", content: text }],
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
    config: { wide_screen_mode: true },
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
  }
}
