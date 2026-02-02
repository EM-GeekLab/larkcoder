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
      return "time_outlined"
    case "fetch":
      return "language_outlined"
    case "switch_mode":
      return "switch_outlined"
    default:
      return "sheet-iconsets-greycircle_filled"
  }
}

function escapeLarkMd(text: string): string {
  return text.replace(/</g, "＜").replace(/>/g, "＞").replace(/\*/g, "﹡").replace(/~/g, "∼")
}

function buildToolCallMarkdown(
  title: string,
  kind?: string,
  textColor?: string,
  iconColor?: string,
): Record<string, unknown> {
  const escaped = escapeLarkMd(title)
  const content = textColor ? `<font color='${textColor}'>${escaped}</font>` : escaped
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
): Record<string, unknown> {
  let textColor: string | undefined
  let iconColor: string
  let statusIcon: { token: string; color: string }

  if (!status) {
    textColor = undefined
    iconColor = "grey"
    statusIcon = { token: "right-small-ccm_outlined", color: "light_grey" }
  } else if (status === "failed") {
    textColor = "grey"
    iconColor = "red"
    statusIcon = { token: "close_outlined", color: "red" }
  } else {
    textColor = "grey"
    iconColor = "grey"
    statusIcon = { token: "done_outlined", color: "green" }
  }

  return {
    tag: "column_set",
    element_id: elementId,
    horizontal_spacing: "8px",
    horizontal_align: "left",
    columns: [
      {
        tag: "column",
        width: "auto",
        vertical_align: "center",
        elements: [buildToolCallMarkdown(title, kind, textColor, iconColor)],
      },
      {
        tag: "column",
        width: "auto",
        vertical_align: "center",
        elements: [
          {
            tag: "div",
            text: { tag: "plain_text", content: "" },
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
