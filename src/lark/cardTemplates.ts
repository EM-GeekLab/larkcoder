import { format } from "date-fns"
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

export const PROCESSING_ELEMENT_ID = "processing_indicator"

export function buildStreamingCard(initialContent?: string): Record<string, unknown> {
  const hasContent = initialContent && initialContent.length > 0
  const placeholderText = "<font color='grey-500'>Pending...</font>"

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
          tag: "column_set",
          flex_mode: "none",
          background_style: "default",
          element_id: "content_area",
          columns: [
            {
              tag: "column",
              width: "weighted",
              weight: 1,
              vertical_align: "top",
              vertical_spacing: "8px",
              element_id: "content_column",
              elements: [
                {
                  tag: "markdown",
                  content: hasContent ? initialContent : placeholderText,
                  element_id: "md_0",
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
          ],
        },
      ],
    },
  }
}

export function buildStreamingMarkdownElement(elementId: string): Record<string, unknown> {
  return {
    tag: "markdown",
    content: "",
    element_id: elementId,
  }
}

function iconTokenForKind(kind?: string): string {
  switch (kind) {
    case "read":
      return "file-link-otherfile_outlined"
    case "edit":
      return "edit_outlined"
    case "delete":
      return "delete-trash_outlined"
    case "move":
      return "viewinchat_outlined"
    case "search":
      return "search_outlined"
    case "execute":
      return "code_outlined"
    case "think":
      return "emoji_outlined"
    case "fetch":
      return "download_outlined"
    case "switch_mode":
      return "switch_outlined"
    default:
      return "setting-inter_outlined"
  }
}

function iconForStatus(
  status: string | undefined,
  kind: string | undefined,
): { token: string; color: string } {
  switch (status) {
    case "completed":
      return { token: "done_outlined", color: "grey" }
    case "failed":
      return { token: "more-close_outlined", color: "red" }
    default:
      return { token: iconTokenForKind(kind), color: "grey" }
  }
}

export function buildToolCallElement(
  elementId: string,
  title: string,
  kind?: string,
  status?: string,
): Record<string, unknown> {
  const icon = iconForStatus(status, kind)
  return {
    tag: "div",
    element_id: elementId,
    text: {
      tag: "plain_text",
      content: title,
      text_size: "notation",
      text_color: status === "failed" ? "red" : "grey",
    },
    icon: {
      tag: "standard_icon",
      token: icon.token,
      color: icon.color,
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

type SelectorItem = {
  label: string
  isCurrent?: boolean
  callbackValue: Record<string, unknown>
}

function buildSelectorCard(items: SelectorItem[]): Record<string, unknown> {
  const hasCurrentItem = items.some((item) => item.isCurrent)

  const interactiveContainers = items.map((item) => {
    const isCurrent = item.isCurrent ?? false
    return {
      tag: "interactive_container",
      width: "fill",
      height: "auto",
      horizontal_align: "left",
      background_style: isCurrent ? "grey-100" : "default",
      has_border: true,
      border_color: isCurrent ? undefined : "grey",
      corner_radius: "8px",
      padding: "4px 12px 4px 12px",
      behaviors: [
        {
          type: "callback",
          value: item.callbackValue,
        },
      ],
      elements: [
        {
          tag: "markdown",
          content: item.label,
          icon:
            hasCurrentItem && isCurrent
              ? { tag: "standard_icon", token: "done_outlined", color: "grey" }
              : undefined,
          margin: hasCurrentItem && !isCurrent ? "0px 0px 0px 23px" : undefined,
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
  currentModel?: string
  models: Array<{ modelId: string; label: string }>
}

export function buildModelSelectCard(data: ModelSelectCardData): Record<string, unknown> {
  return buildSelectorCard(
    data.models.map((m) => ({
      label: m.label,
      isCurrent: data.currentModel ? m.modelId === data.currentModel : undefined,
      callbackValue: { action: "model_select", session_id: data.sessionId, model_id: m.modelId },
    })),
  )
}

type ModeSelectCardData = {
  sessionId: string
  currentMode: string
  modes: Array<{ modeId: string; label: string }>
}

export function buildModeSelectCard(data: ModeSelectCardData): Record<string, unknown> {
  return buildSelectorCard(
    data.modes.map((m) => ({
      label: m.label,
      isCurrent: m.modeId === data.currentMode,
      callbackValue: { action: "mode_select", session_id: data.sessionId, mode_id: m.modeId },
    })),
  )
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
