export type ParsedCommand = {
  command: string
  args: string
}

export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith("/")) {
    return null
  }

  const spaceIndex = trimmed.indexOf(" ")
  if (spaceIndex === -1) {
    return { command: trimmed.slice(1).toLowerCase(), args: "" }
  }

  return {
    command: trimmed.slice(1, spaceIndex).toLowerCase(),
    args: trimmed.slice(spaceIndex + 1).trim(),
  }
}
