#!/usr/bin/env bun
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { getConfigPath } from "../src/config/path"
import { start } from "../src/index"
import { type LogLevel, LOG_LEVELS, setLogLevel } from "../src/utils/logger"
import { getExampleConfig } from "./config-example.macro.ts" with { type: "macro" }

interface CliArgs {
  configPath?: string
  logLevel?: LogLevel
  init?: boolean
  help?: boolean
}

function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value)
}

function parseArgs(): CliArgs {
  const args: CliArgs = {}
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i]
    if (arg === "--config" || arg === "-c") {
      args.configPath = process.argv[++i]
    } else if (arg === "--log-level" || arg === "-l") {
      const value = process.argv[++i]
      if (!value || !isLogLevel(value)) {
        console.error(`Error: Invalid log level: ${value}`)
        console.error(`Valid levels: ${LOG_LEVELS.join(", ")}`)
        process.exit(1)
      }
      args.logLevel = value
    } else if (arg === "--init" || arg === "-i") {
      args.init = true
    } else if (arg === "--help" || arg === "-h") {
      args.help = true
    }
  }
  return args
}

function showHelp(): void {
  console.log(`LarkCoder - Control ACP-compatible Coding Agents via Lark/Feishu IM

Usage:
  bunx --bun larkcoder [options]

Options:
  -c, --config <path>      Specify config file path (default: .larkcoder/config.yaml)
  -l, --log-level <level>  Set log level (${LOG_LEVELS.join(", ")})
  -i, --init               Initialize config file from template
  -h, --help               Show help message

Environment Variables:
  LOG_LEVEL    Set log level (overridden by --log-level flag)
  CONFIG_PATH  Set config file path (overridden by --config flag)

Examples:
  bunx --bun larkcoder --init
  bunx --bun larkcoder --config ./my-config.yaml
  bunx --bun larkcoder --log-level debug
  LOG_LEVEL=warn bunx --bun larkcoder
`)
}

function initConfig(configPath: string): void {
  if (existsSync(configPath)) {
    console.error(`Error: Config file already exists: ${configPath}`)
    process.exit(1)
  }

  mkdirSync(dirname(configPath), { recursive: true })
  const exampleContent = getExampleConfig()
  writeFileSync(configPath, exampleContent, "utf8")
  console.log(`Config file created: ${configPath}`)
  console.log(
    `Please edit the config file and fill in your Lark/Feishu app credentials, then run again.`,
  )
}

async function main(): Promise<void> {
  const args = parseArgs()

  if (args.help) {
    showHelp()
    return
  }

  const configPath = resolve(args.configPath ?? getConfigPath())

  if (args.init) {
    initConfig(configPath)
    return
  }

  // Apply log level: CLI flag > env var > default
  const envLogLevel = process.env.LOG_LEVEL
  const logLevel = args.logLevel ?? (envLogLevel && isLogLevel(envLogLevel) ? envLogLevel : undefined)
  if (logLevel) {
    setLogLevel(logLevel)
  }

  if (!existsSync(configPath)) {
    console.error(`Error: Config file not found: ${configPath}`)
    console.error(`Hint: Use --init option to create config file from template`)
    process.exit(1)
  }

  await start(configPath)
}

main().catch((error: unknown) => {
  console.error("Fatal error:", error instanceof Error ? error.message : String(error))
  if (error instanceof Error && error.stack) {
    console.error(error.stack)
  }
  process.exit(1)
})
