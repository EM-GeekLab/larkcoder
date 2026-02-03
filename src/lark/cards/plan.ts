import type { PlanEntry } from "../../orchestrator/types"
import { escapeLarkMd } from "./common"

type StatusStyle = {
  iconToken: string
  iconColor: string
  formatContent: (escaped: string) => string
}

const STATUS_STYLES: Record<string, StatusStyle> = {
  completed: {
    iconToken: "todo_outlined",
    iconColor: "light_grey",
    formatContent: (escaped) => `<font color=grey>~~${escaped}~~</font>`,
  },
  in_progress: {
    iconToken: "replace_outlined",
    iconColor: "grey",
    formatContent: (escaped) => escaped,
  },
  pending: {
    iconToken: "w1-h1_outlined",
    iconColor: "black",
    formatContent: (escaped) => escaped,
  },
}

const PRIORITY_ICONS: Record<string, string> = {
  high: "up-top_outlined",
  medium: "up_outlined",
}

function buildPlanEntryElement(entry: PlanEntry): Record<string, unknown> {
  const style = STATUS_STYLES[entry.status] ?? STATUS_STYLES.pending!
  const escaped = escapeLarkMd(entry.content)
  const content = style.formatContent(escaped)

  const markdownElement: Record<string, unknown> = {
    tag: "markdown",
    content,
    icon: {
      tag: "standard_icon",
      token: style.iconToken,
      color: style.iconColor,
    },
  }

  const priorityToken = PRIORITY_ICONS[entry.priority]
  if (!priorityToken) {
    return markdownElement
  }

  return {
    tag: "column_set",
    flex_mode: "none",
    horizontal_spacing: "8px",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        vertical_align: "center",
        elements: [markdownElement],
      },
      {
        tag: "column",
        width: "auto",
        vertical_align: "center",
        elements: [
          {
            tag: "div",
            text: { tag: "lark_md", content: "" },
            icon: { tag: "standard_icon", token: priorityToken },
          },
        ],
      },
    ],
  }
}

export function buildPlanCard(entries: PlanEntry[]): Record<string, unknown> {
  return {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    body: {
      elements: entries.map((entry) => buildPlanEntryElement(entry)),
    },
  }
}
