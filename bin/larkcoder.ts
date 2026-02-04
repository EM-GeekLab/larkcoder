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
  console.log(`LarkCoder - 通过飞书 IM 消息控制 ACP 兼容的 Coding Agent

用法:
  bunx --bun larkcoder [选项]

选项:
  -c, --config <path>  指定配置文件路径 (默认: config.yaml)
  -i, --init           初始化配置文件（从模板创建）
  -h, --help           显示帮助信息

示例:
  bunx --bun larkcoder --init
  bunx --bun larkcoder --config ./my-config.yaml
  bunx --bun larkcoder
`)
}

function initConfig(configPath: string): void {
  if (existsSync(configPath)) {
    console.error(`错误: 配置文件已存在: ${configPath}`)
    process.exit(1)
  }

  const exampleContent = getExampleConfig()
  writeFileSync(configPath, exampleContent, "utf8")
  console.log(`✓ 已创建配置文件: ${configPath}`)
  console.log(`请编辑配置文件并填写飞书应用凭据，然后重新运行。`)
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
    console.error(`错误: 配置文件不存在: ${configPath}`)
    console.error(`提示: 使用 --init 选项从模板创建配置文件`)
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
