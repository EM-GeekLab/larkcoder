import { cancel, confirm, group, intro, note, outro, password, text } from "@clack/prompts"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { template } from "radashi"
import { getConfigTemplate } from "../../bin/config-example.macro.ts" with { type: "macro" }

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
      advanced: () =>
        confirm({
          message: "Customize advanced settings?",
          initialValue: false,
        }),
    },
    { onCancel },
  )

  let agentCommand = "claude-code-acp"
  let streamFlushInterval = "150"
  let eventMaxAge = "86400"

  if (basic.advanced) {
    const advanced = await group(
      {
        agentCommand: () =>
          text({
            message: "ACP server command to launch coding agent",
            defaultValue: "claude-code-acp",
            placeholder: "claude-code-acp",
          }),
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
    agentCommand = advanced.agentCommand
    streamFlushInterval = advanced.streamFlushInterval
    eventMaxAge = advanced.eventMaxAge
  }

  const config = template(getConfigTemplate(), {
    app_id: basic.appId,
    app_secret: basic.appSecret,
    working_dir: basic.workingDir,
    db_path: basic.dbPath,
    agent_command: agentCommand,
    stream_flush_interval: streamFlushInterval,
    event_max_age: eventMaxAge,
  })

  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, config, "utf8")

  note(`Config saved to ${configPath}`)
  outro("Setup complete!")
}
