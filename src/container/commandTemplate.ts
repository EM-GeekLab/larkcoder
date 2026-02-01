export type ParsedCommand = {
  command: string
  args: string[]
}

export function splitCommand(input: string): string[] {
  const tokens: string[] = []
  let current = ""
  let quote: "'" | '"' | null = null
  let escaped = false

  for (const char of input) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === "\\" && quote !== "'") {
      escaped = true
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === "'" || char === '"') {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current)
        current = ""
      }
      continue
    }

    current += char
  }

  if (escaped) {
    throw new Error("Trailing escape in command template")
  }

  if (quote) {
    throw new Error("Unclosed quote in command template")
  }

  if (current.length > 0) {
    tokens.push(current)
  }

  return tokens
}

export function parseCommand(input: string): ParsedCommand {
  const tokens = splitCommand(input)
  if (tokens.length === 0) {
    throw new Error("Command template is empty")
  }

  const [command, ...args] = tokens
  if (!command) {
    throw new Error("Command template did not include an executable")
  }

  return { command, args }
}

export function extractFlagValue(
  args: string[],
  flag: string,
): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg) {
      continue
    }

    if (arg === flag) {
      return args[index + 1]
    }

    if (arg.startsWith(`${flag}=`)) {
      return arg.slice(flag.length + 1)
    }
  }

  return undefined
}
