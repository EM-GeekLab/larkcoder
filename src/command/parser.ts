export type ParsedCommand = {
  command: string
  args: string
  type: "slash" | "shell"
}

export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim()

  // Detect shell commands (flexible spacing: !ls, ! ls, !  ls all work)
  if (trimmed.startsWith("!")) {
    const commandText = trimmed.slice(1).trim() // Remove ! and trim spaces
    if (!commandText) {
      return null
    }
    return {
      command: "shell",
      args: commandText,
      type: "shell",
    }
  }

  // Existing slash command logic
  if (!trimmed.startsWith("/")) {
    return null
  }

  const spaceIndex = trimmed.indexOf(" ")
  if (spaceIndex === -1) {
    return {
      command: trimmed.slice(1).toLowerCase(),
      args: "",
      type: "slash",
    }
  }

  return {
    command: trimmed.slice(1, spaceIndex).toLowerCase(),
    args: trimmed.slice(spaceIndex + 1).trim(),
    type: "slash",
  }
}
