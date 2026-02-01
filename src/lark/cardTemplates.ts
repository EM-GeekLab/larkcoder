import type { Session } from "../session/types.js"

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) {
    return text
  }
  return `${text.slice(0, maxLen)}...`
}

type PostElement = Record<string, unknown>

export function buildWorkingPost(text: string): Record<string, unknown> {
  return { zh_cn: { title: "", content: [[{ tag: "text", text }]] } }
}

type PermissionCardData = {
  sessionId: string
  toolDescription: string
  options: Array<{ optionId: string; label: string }>
}

export function buildPermissionCard(
  data: PermissionCardData,
): Record<string, unknown> {
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
              content: data.options
                .map((opt, idx) => `**${idx + 1}.** ${opt.label}`)
                .join("\n"),
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

export function buildSessionListCard(
  data: SessionListCardData,
): Record<string, unknown> {
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

export function buildSessionDeleteCard(
  data: SessionListCardData,
): Record<string, unknown> {
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

export function buildModelSelectCard(
  data: ModelSelectCardData,
): Record<string, unknown> {
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

export function buildResultPost(text: string): Record<string, unknown> {
  const content: PostElement[][] = []

  if (text) {
    content.push([{ tag: "text", text: truncate(text, 4000) }])
  }

  if (content.length === 0) {
    content.push([{ tag: "text", text: "(no output)" }])
  }

  return { zh_cn: { title: "", content } }
}

export function buildErrorPost(error: string): Record<string, unknown> {
  const content: PostElement[][] = [
    [
      { tag: "text", text: "Error: ", style: ["bold"] },
      { tag: "text", text: truncate(error, 2000) },
    ],
  ]

  return { zh_cn: { title: "", content } }
}
