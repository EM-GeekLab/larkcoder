import { capitalize } from "radashi"

export type ToolCallDisplay = {
  title: string
  kind?: string
  label?: string
}

type KindConfig = {
  label: string
  aliases: string[]
}

const KIND_CONFIG: Record<string, KindConfig> = {
  read: { label: "Read", aliases: ["read"] },
  edit: { label: "Edit", aliases: ["edit", "write"] },
  delete: { label: "Delete", aliases: ["delete", "remove"] },
  move: { label: "Move", aliases: ["move", "rename"] },
  search: { label: "Search", aliases: ["search", "grep", "find"] },
  execute: { label: "Run", aliases: ["run", "bash", "exec", "execute", "shell"] },
  think: { label: "Think", aliases: ["think"] },
  fetch: { label: "Fetch", aliases: ["fetch", "websearch", "search"] },
  switch_mode: { label: "Switch", aliases: ["switch"] },
}

export function labelForKind(kind?: string): string | undefined {
  if (!kind) {
    return undefined
  }
  return KIND_CONFIG[kind]?.label
}

/**
 * Resolve label considering title aliases.
 * Returns undefined if title already starts with a known alias for this kind.
 */
export function resolveLabelForTitle(kind: string | undefined, title: string): string | undefined {
  const config = kind ? KIND_CONFIG[kind] : undefined
  if (!config) {
    return undefined
  }
  const titleLower = title.toLowerCase()
  if (config.aliases.some((a) => titleLower.startsWith(a))) {
    return undefined
  }
  return config.label
}

/**
 * Extract display info from an ACP tool_call event.
 * Uses standard ACP fields by default, with targeted fixes for Claude Code quirks.
 */
export function extractToolCallDisplay(update: Record<string, unknown>): ToolCallDisplay {
  let title = update.title as string | undefined
  const kind = update.kind as string | undefined

  // Claude Code-specific fixes
  const meta = update._meta as Record<string, unknown> | undefined
  const claudeCode = meta?.claudeCode as Record<string, unknown> | undefined
  const toolName = claudeCode?.toolName as string | undefined

  if (toolName === "Read") {
    const locations = update.locations as Array<Record<string, unknown>> | undefined
    const path = locations?.[0]?.path as string | undefined
    if (path) {
      title = path
    }
  }

  // WebSearch title prefix (ACP sends kind=fetch, same as WebFetch)
  if (toolName === "WebSearch" && title && !title.toLowerCase().startsWith("search")) {
    title = `Search ${title}`
  }

  const resolvedTitle = title ?? "Tool Call"

  // Resolve label from kind config + aliases
  let label: string | undefined
  let finalTitle = resolvedTitle

  const config = kind ? KIND_CONFIG[kind] : undefined
  if (config) {
    const titleLower = resolvedTitle.toLowerCase()
    const matched = config.aliases.find((a) => titleLower.startsWith(a))
    if (matched) {
      finalTitle = capitalize(matched) + resolvedTitle.slice(matched.length)
    } else {
      label = config.label
    }
  }

  return { title: finalTitle, kind, label }
}
