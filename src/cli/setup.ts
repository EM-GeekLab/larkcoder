import {
  cancel,
  confirm,
  group,
  intro,
  isCancel,
  note,
  outro,
  password,
  select,
  text,
} from "@clack/prompts"
import { YAML } from "bun"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { template } from "radashi"
import { getConfigTemplate } from "../../bin/config-example.macro.ts" with { type: "macro" }
import { rawConfigSchema } from "../config/schema"

type ConfigValues = {
  app_id: string
  app_secret: string
  working_dir: string
  db_path: string
  agent_command: string
  stream_flush_interval: string
  event_max_age: string
}

function validatePositiveInt(v: string | undefined): string | undefined {
  if (!v) {
    return undefined
  }
  const n = Number.parseInt(v, 10)
  if (Number.isNaN(n) || n <= 0) {
    return "Must be a positive integer"
  }
  return undefined
}

const onCancel = () => {
  cancel("Setup cancelled.")
  process.exit(0)
}

function writeConfig(configPath: string, values: ConfigValues): void {
  const config = template(getConfigTemplate(), values)
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, config, "utf8")
}

const acpServers = [
  { label: "Claude Code", npx: "npx @zed-industries/claude-code-acp", local: "claude-code-acp" },
  { label: "Auggie", npx: "npx @augmentcode/auggie --acp", local: "auggie --acp" },
  { label: "Codex", local: "codex-acp" },
  { label: "Factory Droid", local: "droid exec --output-format acp" },
  {
    label: "Gemini",
    npx: "npx @google/gemini-cli --experimental-acp",
    local: "gemini --experimental-acp",
  },
  { label: "GitHub Copilot", npx: "npx @github/copilot-language-server --acp" },
  { label: "Mistral Vibe", local: "vibe-acp" },
  { label: "OpenCode", local: "opencode acp" },
  {
    label: "Qwen Code",
    npx: "npx @qwen-code/qwen-code --acp --experimental-skills",
    local: "qwen --acp --experimental-skills",
  },
]

function getAgentCommandOptions(): { value: string; label: string; hint: string }[] {
  return acpServers.map((server) => {
    if (server.local) {
      const [binary = ""] = server.local.split(/\s+/)
      if (Bun.which(binary)) {
        return { value: server.local, label: server.label, hint: server.local }
      }
    }
    if (server.npx) {
      return { value: server.npx, label: server.label, hint: server.npx }
    }
    return { value: server.local!, label: server.label, hint: `${server.local!} (not installed)` }
  })
}

async function selectAgentCommand(currentValue?: string): Promise<string | symbol> {
  const options = getAgentCommandOptions()
  const isKnown = currentValue ? options.some((o) => o.value === currentValue) : false

  const choice = await select({
    message: "ACP server to use as coding agent",
    options: [
      ...options,
      {
        value: "custom",
        label: "Custom command...",
        hint: !isKnown && currentValue ? currentValue : undefined,
      },
    ],
    initialValue: isKnown ? currentValue : currentValue ? "custom" : undefined,
  })

  if (isCancel(choice)) {
    return choice
  }

  if (choice === "custom") {
    return text({
      message: "Custom ACP server command",
      initialValue: currentValue,
      validate: (v) => (!v ? "Command is required" : undefined),
    })
  }

  return choice
}

export async function runSetupWizard(configPath: string): Promise<void> {
  intro("LarkCoder Setup")

  const basic = await group(
    {
      appId: () =>
        text({
          message: "Lark/Feishu App ID (from Open Platform console)",
          placeholder: "cli_xxxxxx",
          validate: (v) => (!v ? "App ID is required" : undefined),
        }),
      appSecret: () =>
        password({
          message: "Lark/Feishu App Secret",
          validate: (v) => (!v ? "App Secret is required" : undefined),
        }),
      workingDir: () =>
        text({
          message: "Projects directory (where agent sessions are stored)",
          defaultValue: ".larkcoder/projects",
          placeholder: ".larkcoder/projects",
        }),
      dbPath: () =>
        text({
          message: "Database file path (stores session and event data)",
          defaultValue: ".larkcoder/data/larkcoder.db",
          placeholder: ".larkcoder/data/larkcoder.db",
        }),
      agentCommand: () => selectAgentCommand(),
      advanced: () =>
        confirm({
          message: "Customize advanced settings?",
          initialValue: false,
        }),
    },
    { onCancel },
  )

  let streamFlushInterval = "150"
  let eventMaxAge = "86400"

  if (basic.advanced) {
    const advanced = await group(
      {
        streamFlushInterval: () =>
          text({
            message: "Stream flush interval in ms (throttle streaming output to Lark)",
            defaultValue: "150",
            placeholder: "150",
            validate: validatePositiveInt,
          }),
        eventMaxAge: () =>
          text({
            message: "Event max age in seconds (auto-cleanup old events from database)",
            defaultValue: "86400",
            placeholder: "86400 (1 day)",
            validate: validatePositiveInt,
          }),
      },
      { onCancel },
    )
    streamFlushInterval = advanced.streamFlushInterval
    eventMaxAge = advanced.eventMaxAge
  }

  writeConfig(configPath, {
    app_id: basic.appId,
    app_secret: basic.appSecret,
    working_dir: basic.workingDir,
    db_path: basic.dbPath,
    agent_command: basic.agentCommand,
    stream_flush_interval: streamFlushInterval,
    event_max_age: eventMaxAge,
  })

  note(`Config saved to ${configPath}`)
  outro("Setup complete!")
}

export async function runConfigEditor(configPath: string): Promise<void> {
  const raw = rawConfigSchema.parse(YAML.parse(await Bun.file(configPath).text()))

  const values: ConfigValues = {
    app_id: raw.lark.app_id,
    app_secret: raw.lark.app_secret,
    working_dir: raw.agent.working_dir,
    db_path: raw.database.path,
    agent_command: raw.agent.command,
    stream_flush_interval: String(raw.lark.stream_flush_interval),
    event_max_age: String(raw.database.event_max_age),
  }

  const fieldMessages: Record<string, string> = {
    app_id: "Lark/Feishu App ID",
    working_dir: "Projects directory",
    db_path: "Database file path",
    agent_command: "ACP server command",
    stream_flush_interval: "Stream flush interval (ms)",
    event_max_age: "Event max age (seconds)",
  }

  intro("LarkCoder Configuration")

  while (true) {
    const field = await select({
      message: "Select a setting to modify",
      options: [
        { value: "app_id", label: "Lark App ID", hint: values.app_id },
        { value: "app_secret", label: "Lark App Secret", hint: "****" },
        { value: "working_dir", label: "Projects directory", hint: values.working_dir },
        { value: "db_path", label: "Database path", hint: values.db_path },
        { value: "agent_command", label: "Agent command", hint: values.agent_command },
        {
          value: "stream_flush_interval",
          label: "Stream flush interval",
          hint: `${values.stream_flush_interval} ms`,
        },
        { value: "event_max_age", label: "Event max age", hint: `${values.event_max_age} s` },
        { value: "save", label: "Save and exit" },
      ],
    })

    if (isCancel(field)) {
      cancel("Edit cancelled.")
      process.exit(0)
    }

    if (field === "save") {
      break
    }

    const key = field as keyof ConfigValues
    let newValue: string | symbol

    if (key === "app_secret") {
      newValue = await password({
        message: "Lark/Feishu App Secret",
        validate: (v) => (!v ? "App Secret is required" : undefined),
      })
    } else if (key === "agent_command") {
      newValue = await selectAgentCommand(values[key])
    } else {
      const isNumeric = key === "stream_flush_interval" || key === "event_max_age"
      newValue = await text({
        message: fieldMessages[key] ?? key,
        initialValue: values[key],
        validate: isNumeric
          ? (v) => {
              if (!v) {
                return "This field is required"
              }
              return validatePositiveInt(v)
            }
          : (v) => (!v ? "This field is required" : undefined),
      })
    }

    if (isCancel(newValue)) {
      continue
    }

    values[key] = newValue
  }

  writeConfig(configPath, values)
  note(`Config saved to ${configPath}`)
  outro("Configuration updated!")
}
