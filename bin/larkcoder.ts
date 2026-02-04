#!/usr/bin/env bun
import { existsSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { start } from "../src/index"
import { getExampleConfig } from "./config-example.macro.ts" with { type: "macro" }

const DEFAULT_CONFIG_NAME = "config.yaml"

function parseArgs(): { configPath?: string; init?: boolean; help?: boolean } {
  const args: { configPath?: string; init?: boolean; help?: boolean } = {}
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i]
    if (arg === "--config" || arg === "-c") {
      args.configPath = process.argv[++i]
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
  -c, --config <path>  Specify config file path (default: config.yaml)
  -i, --init           Initialize config file from template
  -h, --help           Show help message

Examples:
  bunx --bun larkcoder --init
  bunx --bun larkcoder --config ./my-config.yaml
  bunx --bun larkcoder
`)
}

function initConfig(configPath: string): void {
  if (existsSync(configPath)) {
    console.error(`Error: Config file already exists: ${configPath}`)
    process.exit(1)
  }

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

  const configPath = resolve(args.configPath ?? process.env.CONFIG_PATH ?? DEFAULT_CONFIG_NAME)

  if (args.init) {
    initConfig(configPath)
    return
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
