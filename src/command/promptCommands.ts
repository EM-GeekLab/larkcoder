type PromptSubcommand = {
  description: string
  prompt: string | ((args: string) => string)
}

type PromptCommandGroup = {
  description: string
  subcommands: Record<string, PromptSubcommand>
}

const PROMPT_COMMANDS: Record<string, PromptCommandGroup> = {
  git: {
    description: "Git operations (via Agent)",
    subcommands: {
      commit: {
        description: "Auto-analyze changes and commit",
        prompt: (args) =>
          args
            ? `Review all changes, write a commit message, and create the commit. Hint: ${args}`
            : "Review all changes, write a clear commit message, and create the commit.",
      },
      pr: {
        description: "Create GitHub Pull Request",
        prompt: (args) =>
          args
            ? `Create a GitHub Pull Request targeting the '${args}' branch. Analyze all commits and changes, generate a title and description.`
            : "Create a GitHub Pull Request for the current branch. Analyze all commits and changes, generate a title and description.",
      },
    },
  },
}

export type ResolveResult = { type: "prompt"; prompt: string } | { type: "help"; help: string }

export function isPromptCommand(command: string): boolean {
  return command in PROMPT_COMMANDS
}

export function resolvePromptCommand(command: string, args: string): ResolveResult | null {
  const group = PROMPT_COMMANDS[command]
  if (!group) {
    return null
  }

  const parts = args.trim().split(/\s+/)
  const sub = parts[0]?.toLowerCase()
  const subcommand = sub ? group.subcommands[sub] : undefined

  if (!subcommand) {
    return { type: "help", help: generateGroupHelp(command, group) }
  }

  const subArgs = parts.slice(1).join(" ")
  const prompt =
    typeof subcommand.prompt === "function" ? subcommand.prompt(subArgs) : subcommand.prompt

  return { type: "prompt", prompt }
}

function generateGroupHelp(name: string, group: PromptCommandGroup): string {
  return Object.entries(group.subcommands)
    .map(([sub, def]) => `/${name} ${sub} — ${def.description}`)
    .join("\n")
}

export function generatePromptCommandHelp(): string {
  return Object.entries(PROMPT_COMMANDS)
    .flatMap(([name, group]) =>
      Object.entries(group.subcommands).map(([sub, def]) => `/${name} ${sub} — ${def.description}`),
    )
    .join("\n")
}
