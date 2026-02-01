import type { TaskStatus } from "../task/types.js"

type CardData = {
  taskId: string
  status: TaskStatus
  prompt: string
  summary?: string
  lastActivity?: string
  errorMessage?: string
}

const headerTemplates: Record<string, { title: string; template: string }> = {
  pending: { title: "Pending", template: "grey" },
  running: { title: "Running", template: "blue" },
  waiting: { title: "Waiting", template: "orange" },
  completed: { title: "Completed", template: "green" },
  failed: { title: "Failed", template: "red" },
  cancelled: { title: "Cancelled", template: "grey" },
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) {
    return text
  }
  return `${text.slice(0, maxLen)}...`
}

export function buildStatusCard(data: CardData): Record<string, unknown> {
  const header = headerTemplates[data.status] ?? headerTemplates.pending!

  const lines: string[] = [`**Task:** ${truncate(data.prompt, 100)}`]

  if (data.summary) {
    lines.push(`**Summary:** ${truncate(data.summary, 200)}`)
  }

  if (data.lastActivity) {
    lines.push(`**Activity:** ${truncate(data.lastActivity, 150)}`)
  }

  if (data.errorMessage) {
    lines.push(`**Error:** ${truncate(data.errorMessage, 200)}`)
  }

  const elements: Record<string, unknown>[] = [
    { tag: "markdown", content: lines.join("\n") },
  ]

  const actions = buildActions(data)
  if (actions.length > 0) {
    elements.push({ tag: "action", actions })
  }

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: header.title },
      template: header.template,
    },
    elements,
  }
}

function buildActions(data: CardData): Record<string, unknown>[] {
  const actions: Record<string, unknown>[] = []

  switch (data.status) {
    case "running":
      actions.push({
        tag: "button",
        text: { tag: "plain_text", content: "Stop" },
        type: "danger",
        value: { action: "stop", task_id: data.taskId },
      })
      break

    case "waiting":
      actions.push(
        {
          tag: "button",
          text: { tag: "plain_text", content: "Continue" },
          type: "primary",
          value: { action: "continue", task_id: data.taskId },
        },
        {
          tag: "button",
          text: { tag: "plain_text", content: "Done" },
          type: "default",
          value: { action: "complete", task_id: data.taskId },
        },
      )
      break

    case "failed":
      actions.push({
        tag: "button",
        text: { tag: "plain_text", content: "Retry" },
        type: "primary",
        value: { action: "retry", task_id: data.taskId },
      })
      break
  }

  return actions
}
