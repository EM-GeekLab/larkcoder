import { escapeLarkMd } from "./common"

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

export function buildStreamingThoughtElement(elementId: string): Record<string, unknown> {
  return {
    tag: "markdown",
    content: "",
    text_size: "notation",
    element_id: elementId,
  }
}

const iconTokenByKind: Record<string, string> = {
  read: "file-link-otherfile_outlined",
  edit: "edit_outlined",
  delete: "delete-trash_outlined",
  move: "viewinchat_outlined",
  search: "search_outlined",
  execute: "code_outlined",
  think: "time_outlined",
  fetch: "language_outlined",
  switch_mode: "switch_outlined",
}

function iconTokenForKind(kind?: string): string {
  return (kind && iconTokenByKind[kind]) ?? "ellipse_outlined"
}

function buildToolCallMarkdown(
  title: string,
  kind?: string,
  textColor?: string,
  iconColor?: string,
  label?: string,
): Record<string, unknown> {
  const sanitized = kind === "execute" ? title : title.replace(/`/g, '"')
  const escaped = escapeLarkMd(sanitized)
  const prefixed = label ? `${label} ${escaped}` : escaped
  const content = textColor ? `<font color='${textColor}'>${prefixed}</font>` : prefixed
  return {
    tag: "markdown",
    content,
    text_size: "notation",
    icon: {
      tag: "standard_icon",
      token: iconTokenForKind(kind),
      color: iconColor ?? "grey",
    },
  }
}

export function buildToolCallElement(
  elementId: string,
  title: string,
  kind?: string,
  status?: string,
  duration?: string,
  label?: string,
): Record<string, unknown> {
  let textColor: string | undefined
  let iconColor: string
  let statusIcon: { token: string; color: string }

  if (!status) {
    textColor = undefined
    iconColor = "grey"
    statusIcon = { token: "time_outlined", color: "light_grey" }
  } else if (status === "failed") {
    textColor = "grey"
    iconColor = "red"
    statusIcon = { token: "close_outlined", color: "red" }
  } else {
    textColor = "grey"
    iconColor = "grey"
    statusIcon = { token: "done_outlined", color: "green" }
  }

  const suffixContent = status && duration ? `<font color='grey'>${duration}</font>` : ""

  return {
    tag: "column_set",
    element_id: elementId,
    flex_mode: "flow",
    horizontal_spacing: "8px",
    horizontal_align: "left",
    columns: [
      {
        tag: "column",
        width: "auto",
        vertical_align: "center",
        elements: [buildToolCallMarkdown(title, kind, textColor, iconColor, label)],
      },
      {
        tag: "column",
        width: "auto",
        vertical_align: "center",
        elements: [
          {
            tag: "div",
            text: { tag: "lark_md", content: suffixContent, text_size: "notation" },
            icon: {
              tag: "standard_icon",
              token: statusIcon.token,
              color: statusIcon.color,
            },
          },
        ],
      },
    ],
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
