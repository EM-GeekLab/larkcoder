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
